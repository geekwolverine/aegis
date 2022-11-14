'use strict'

import { workerData, BroadcastChannel, isMainThread } from 'worker_threads'
import { modelsInDomain } from './use-cases'
const modelName = isMainThread ? null : workerData.poolName

export class PortEventRouter {
  constructor (models, broker) {
    this.models = models
    this.broker = broker
  }

  getThreadLocalPorts () {
    return this.models
      .getModelSpecs()
      .filter(
        spec =>
          spec.ports &&
          ((spec.domain &&
            modelsInDomain(spec.domain).includes(spec.modelName)) ||
            spec.modelName === modelName)
      )
      .flatMap(spec =>
        Object.values(spec.ports)
          .filter(port => port.consumesEvent || port.producesEvent)
          .map(port => ({ ...port, modelName: spec.modelName }))
      )
  }

  getThreadRemotePorts () {
    return this.models
      .getModelSpecs()
      .filter(
        spec =>
          spec.ports &&
          !this.getThreadLocalPorts().some(
            port => port.modelName === spec.modelName
          )
      )
      .flatMap(
        Object.values(spec.ports)
          .filter(port => port.consumesEvent || port.producesEvent)
          .map(port => ({ ...port, modelName: spec.modelName }))
      )
  }

  handleChannelEvent (msg) {
    if (msg.data.eventName) this.broker.notify(msg.data.eventName, msg.data)
    else {
      console.log('missing eventName', msg.data)
      this.broker.notify('missingEventName', msg.data)
    }
  }

  /**
   * Listen for producer events from other thread pools and invoke
   * local ports that consume them. Listen for local producer events
   * and forward to pools that consume them. If a producer event is
   * not consumed by any local thread, foward to service mesh.
   */
  listen () {
    const localPorts = this.getThreadLocalPorts()
    const remotePorts = this.getThreadRemotePorts()

    const publishPorts = remotePorts.filter(remote =>
      localPorts.find(local => local.producesEvent === remote.consumesEvent)
    )
    const subscribePorts = remotePorts.filter(remote =>
      localPorts.find(local => local.consumesEvent === remote.producesEvent)
    )
    const unhandledPorts = localPorts.filter(
      remote =>
        !remotePorts.find(local => local.producesEvent === remote.consumesEvent)
    )

    const services = new Set()
    const channels = new Map()

    publishPorts.forEach(port => services.add(port.modelName))
    subscribePorts.forEach(port => services.add(port.modelName))

    services.forEach(service =>
      channels.set(service, new BroadcastChannel(service))
    )

    console.log('publishPorts', publishPorts)
    console.log('subscribePorts', subscribePorts)
    console.log('unhandledPorts', unhandledPorts)
    console.log('channels', channels)

    // dispatch outgoing events
    publishPorts.forEach(port =>
      this.broker.on(port.consumesEvent, event => {
        console.log('broadcasting...', { port, event })
        channels
          .get(port.modelName)
          .postMessage(JSON.parse(JSON.stringify(event)))
      })
    )

    // listen for incoming events
    subscribePorts.forEach(port => {
      channels.get(port.modelName).onmessage = msg => {
        console.log('subscribePorts.onmessage', msg.data)
        this.handleChannelEvent(msg)
      }
    })

    unhandledPorts.forEach(port => {
      this.broker.on(port.producesEvent, event => {
        this.broker.notify('to_main', event)
      })
    })

    // listen to this model's channel
    new BroadcastChannel(modelName).onmessage = msg => {
      console.log('onmessage', msg.data)
      this.handleChannelEvent(msg)
    }
  }
}
