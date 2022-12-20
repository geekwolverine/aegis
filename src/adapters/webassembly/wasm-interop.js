'use strict'

/** @typedef {import("../../domain").ModelSpecification} ModelSpecification */
/** @typedef {import("../../domain").Model} Model */
/** @typedef {{[x:string]:()=>void}} Service */
/** @typedef {function(Service):function(*):Promise} Adapter */

/**
 * WASM interop functions
 * - call any exported function
 *   (no js glue code required)
 * - import port configuration
 * - import inbound port functions
 * - import commands
 * @param {WebAssembly.Exports} wasmExports
 * @returns adapter functions
 */
exports.WasmInterop = function (wasmExports) {
  const {
    getCommands,
    getPorts,
    liftString,
    liftArray,
    lowerString,
    lowerArray,
    store_ref,
    notnull,
    memory,
    _exports,
  } = wasmExports

  function parse(v) {
    return !isNaN(parseInt(v))
      ? parseInt(v)
      : !isNaN(parseFloat(v))
      ? parseFloat(v)
      : /true/i.test(v)
      ? true
      : /false/i.test(v)
      ? false
      : v
  }

  /**
   *
   * @param {string} fn function name
   * @param {string[][]} kv key-value pairs
   * @returns {object}
   */
  function lift(fn, kv) {
    return liftArray(
      pointer =>
        liftArray(
          pointer => liftString(new Uint32Array(memory.buffer)[pointer >>> 2]),
          2,
          new Uint32Array(memory.buffer)[pointer >>> 2]
        ),
      2,
      _exports[fn](kv) >>> 0
    )
      .map(([k, v]) => ({ [k]: parse(v) }))
      .reduce((a, b) => ({ ...a, ...b }))
  }

  /**
   *
   * @param {string[][]} kv key-value pairs in a 2 dimensional string array
   * @returns {string[][]}
   */
  function lower(kv) {
    return (
      lowerArray(
        (pointer, value) => {
          store_ref(
            pointer,
            lowerArray(
              (pointer, value) => {
                store_ref(pointer, lowerString(value) || notnull())
              },
              4,
              2,
              value
            ) || notnull()
          )
        },
        5,
        2,
        kv
      ) || notnull()
    )
  }

  function clean(obj) {
    const convert = obj =>
      Object.entries(obj)
        .filter(([k, v]) => ['string', 'number', 'boolean'].includes(typeof v))
        .map(([k, v]) => [k, v.toString()])

    // handle custom port format
    if (obj.port && obj.args) return convert(obj.args)
    return convert(obj)
  }

  /**
   * Parse the input object into a multidimensional array of key-value pairs
   * and pass it as an argument to the exported wasm function. Do the reverse for
   * the response. Consequently, any wasm port or command function must accept a
   * multidemensional array of strings (numbers are converted to strings) and return
   * a multidimensional array of strings. Before they can be called, they must be 
   * registered in a modelspec, i.e. getPorts() and getCommands() must return 
   * appropria metadata.

   * @param {string} fn exported wasm function name
   * @param {object|number} [obj] object, see above
   * @returns {object|number} object
   */
  function callWasmFunction(fn, obj) {
    return lift(fn, lower(clean(obj)))
  }

  return Object.freeze({
    /**
     * For every command in {@link getCommands} create a
     * an entry that will invoke one or more of the exported
     * wasm functions.
     */
    importWasmCommands() {
      const commandNames = getCommands()
      return Object.keys(commandNames)
        .map(command => {
          return {
            [command]: {
              command: model =>
                callWasmFunction(command, {
                  ...model,
                  modelId: model.getId(),
                  modelName: model.getName(),
                }),
              acl: ['read', 'write'],
            },
          }
        })
        .reduce((p, c) => ({ ...p, ...c }), {})
    },

    /**
     * For every port in {@link getPorts} create a
     * an entry that in the {@link ModelSpecification.ports}
     * that will invoke one or more of the exported
     * wasm functions.
     */
    importWasmPorts() {
      const ports = getPorts()
      return Object.keys(ports)
        .map(port => {
          const [
            service,
            type,
            consumesEvent,
            producesEvent,
            callback,
            undo,
            inbound,
          ] = ports[port].split(',')
          return {
            [port]: {
              service,
              type,
              consumesEvent,
              producesEvent,
              callback: data => callWasmFunction(callback, data),
              undo: data => callWasmFunction(undo, data),
              inbound(port, args, id) {
                callWasmFunction(inbound, { port, ...args, id })
              },
            },
          }
        })
        .reduce((p, c) => ({ ...p, ...c }), {})
    },

    /**
     *
     * @returns {{[x: string]:(x) => any}}
     */
    importWasmPortFunctions() {
      return Object.entries(getPorts())
        .map(([k, v]) => [k, v.split(',')[1]])
        .filter(([k, v]) => v === 'inbound')
        .map(([k, v]) => ({ [k]: x => callWasmFunction(k, x) }))
        .reduce((a, b) => ({ ...a, ...b }), {})
    },

    callWasmFunction,
  })
}

/**
 * Construct an object from the key-value pairs in the multidimensional array
 * @param {number} ptr - pointer to the address of the array of string arrays
 * @returns {Readonly<{object}>}
 */
// function constructObject (ptr, unpin = true) {
//   if (!ptr) {
//     console.debug(constructObject.name, 'null pointer', ptr)
//     return
//   }

//   try {
//     const obj = liftArray(ptr)
//       .map(inner => liftArray(inner))
//       .map(tuple => ({ [liftString(tuple[0])]: liftString(tuple[1]) }))
//       .reduce((obj1, obj2) => ({ ...obj1, ...obj2 }))

//     const immutableClone = Object.freeze({ ...obj })
//     !unpin || __unpin(ptr)
//     console.debug(constructObject.name, ptr)
//     return immutableClone
//   } catch (e) {
//     console.error(constructObject.name, 'error:', e.message)
//     return {}
//   }
// }
