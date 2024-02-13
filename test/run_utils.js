export const run = tests => {
  // Runs test, return failure or null if not failed
  const run_test = t => {
    return Promise.resolve().then(t.test)
      .then(() => null)
      .catch(e => {
        if(globalThis.process != null) {
          // In node.js runner, fail fast
          console.error('Failed: ' + t.message)
          throw e
        } else {
          return e
        }
      })
  }

  // If not run in node, then dont apply filter
  const filter = globalThis.process && globalThis.process.argv[2]

  if(filter == null) {

    const only = tests.find(t => t.only)
    const tests_to_run = only == null ? tests : [only]

    // Exec each test. After all tests are done, we rethrow first error if
    // any. So we will mark root calltree node if one of tests failed
    return tests_to_run.reduce(
      (failureP, t) => 
        Promise.resolve(failureP).then(failure => 
          run_test(t).then(next_failure => failure ?? next_failure)
        )
      ,
      null
    ).then(failure => {

      if(failure != null) {
        throw failure
      } else {
        if(globalThis.process != null) {
          console.log('Ok')
        }
      }

    })

  } else {
    const test = tests.find(t => t.message.includes(filter))
    if(test == null) {
      throw new Error('test not found')
    } else {
      return run_test(test).then(() => {
        if(globalThis.process != null) {
          console.log('Ok')
        }
      })
    }
  }
}
