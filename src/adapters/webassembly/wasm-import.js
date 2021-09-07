'use strict'

import {
  wrapWasmAdapter,
  wrapWasmModelSpec,
  wrapWasmService
} from './wasm-decorators'
import loader from '@assemblyscript/loader'
import { ObserverFactory } from '../../domain/observer'
const observer = ObserverFactory.getInstance()

const { Octokit } = require('@octokit/rest')
const token = process.env.GITHUB_TOKEN
const octokit = new Octokit({ auth: token })

export function RepoClient (entry) {
  function octoGet () {
    console.info('github url', entry.url)
    const owner = entry.owner
    const repo = entry.repo
    const filedir = entry.filedir
    const branch = entry.branch

    return new Promise(function (resolve, reject) {
      octokit
        .request('GET /repos/{owner}/{repo}/contents/{filedir}?ref={branch}', {
          owner,
          repo,
          filedir,
          branch
        })
        .then(function (rest) {
          const file = rest.data.find(datum => /\.wasm$/.test(datum.name))
          return file.sha
        })
        .then(function (sha) {
          console.log(sha)
          return octokit.request('GET /repos/{owner}/{repo}/git/blobs/{sha}', {
            owner,
            repo,
            sha
          })
        })
        .then(function (rest) {
          const buf = Buffer.from(rest.data.content, 'base64')
          resolve({
            toString: () => buf.toString('utf-8'),
            asBase64Buffer: () => buf,
            arrayBuffer: () => buf.buffer,
            toUint16Array: () =>
              new Uint16Array(
                buf.buffer,
                buf.byteOffset,
                buf.length / Uint16Array.BYTES_PER_ELEMENT
              )
          })
        })
        .catch(err => reject(err))
    })
  }

  function httpGet (params) {
    return new Promise(function (resolve, reject) {
      var req = require(params.protocol.slice(
        0,
        params.protocol.length - 1
      )).request(params, function (res) {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('statusCode=' + res.statusCode))
        }
        var body = []
        res.on('data', function (chunk) {
          body.push(chunk)
        })
        res.on('end', function () {
          try {
            body = Buffer.concat(body).toString()
          } catch (e) {
            reject(e)
          }
          resolve(body)
        })
      })
      req.on('error', function (err) {
        reject(err)
      })
      req.end()
    })
  }

  function fetchWasm () {
    if (/github/i.test(entry.url)) return octoGet()
    return httpGet(entry.url)
  }

  return {
    getModelSpec: fetchWasm,
    getModel: async () => {
      entry = entry.model
      return fetchWasm()
    }
  }
}

export async function importWebAssembly (remoteEntry, type = 'model') {
  const startTime = Date.now()
  // Check if we support streaming instantiation
  if (WebAssembly.instantiateStreaming) console.log('we can stream-compile now')

  const response = await RepoClient(remoteEntry).getModelSpec()
  const wasm = await loader.instantiate(response.asBase64Buffer(), {
    aegis: {
      log: ptr => console.log(wasm.exports.__getString(ptr)),

      invokePort: (portName, portConsumerEvent, portData) =>
        console.log(
          wasm.exports.__getString(portName),
          wasm.exports.__getString(portConsumerEvent),
          wasm.exports.__getString(portData)
        ),

      invokeMethod: (methodName, methodData, moduleName) =>
        console.log(
          wasm.exports.__getString(methodName),
          wasm.exports.__getString(methodData),
          wasm.exports.__getString(moduleName)
        ),

      websocketListen: (eventName, callbackName) => {
        console.debug('websocket listen invoked')
        observer.listen(eventName, eventData => {
          const cmd = adapter.findWasmCommand(
            wasm.exports.__getString(callbackName)
          )
          if (typeof cmd === 'function') {
            adapter.callWasmFunction(cmd, eventData, false)
          }
          console.log('no command found')
        })
      },

      websocketNotify: (eventName, eventData) => {
        console.log(
          'wasm called js to send an event',
          wasm.exports.__getString(eventName)
        )
        observer.notify(
          wasm.exports.__getString(eventName),
          wasm.exports.__getString(eventData)
        )
      },
      requestDeployment: (webswitchId, remoteEntry) => console.log('deploy')
    }
  })
  console.info('wasm modules took %dms', Date.now() - startTime)

  // allow imports access to memory
  // compile with --explicitStart
  wasm.instance.exports._start()

  if (type === 'model') return wrapWasmModelSpec(wasm, remoteEntry)
  if (type === 'adapter') return wrapWasmAdapter(wasm)
  if (type === 'service') return wrapWasmService(wasm)
}
