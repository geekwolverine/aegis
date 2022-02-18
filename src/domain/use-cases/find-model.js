'use strict'

import { isMainThread } from 'worker_threads'
import executeCommand from './execute-command'
import fetchRelatedModels from './find-related-models'
import async from '../util/async-error'

/**
 * @typedef {Object} ModelParam
 * @property {String} modelName
 * @property {import('../datasource').default} repository
 * @property {import('../event-broker').EventBroker} broker
 * @property {import('../model-factory').ModelFactory} models
 * @property {import('../thread-pool').ThreadPoolFactory} threadpool
 * @property {...Function} handlers
 */

/**
 * @callback findModel
 * @param {string} id
 * @param {{key1:string,keyN:string}} query,
 * @returns {Promise<import("../model").Model>}
 *
 * @param {ModelParam} param0
 * @returns {findModel}
 */
export default function makeFindModel ({
  threadpool,
  repository,
  models,
  modelName,
  broker
} = {}) {
  return async function findModel ({ id, query, model }) {
    if (isMainThread) {
      // Main thread performs read operations
      const model = await repository.find(id)

      if (!model) {
        throw new Error('no such id')
      }
      // Only send to app thread if data must be enriched
      if (!query.relation && !query.command) return model

      const result = await threadpool.run(findModel.name, { id, query, model })

      if (result.hasError) throw new Error(result.message)
      return result
    } else {
      // unmarshall the model so we can use it
      const hydratedModel = models.loadModel(
        broker,
        repository,
        model,
        modelName
      )

      if (query.relation) {
        const related = await async(
          fetchRelatedModels(hydratedModel, query.relation)
        )
        if (related.ok) {
          return related.data
        }
      }

      if (query.command) {
        const result = await async(
          executeCommand(hydratedModel, query.command, 'read')
        )
        if (result.ok) {
          return result.data
        }
      }

      // gracefully degrade
      return hydratedModel
    }
  }
}
