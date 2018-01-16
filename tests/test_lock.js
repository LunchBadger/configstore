'use strict';

let sinon = require('sinon');
let lock = require('../server/lib/lock');
let chai = require('chai');
let chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
let assert = chai.assert;

describe('File locking system', function () {
  it('should call provided function', async function () {
    let testFn = sinon.spy();
    await lock('/tmp/testlock', testFn);
    assert(testFn.called);
  });

  it('should unlock after calling the function', async function () {
    let testFn = sinon.spy();
    await lock('/tmp/testlock', testFn);
    await lock('/tmp/testlock', testFn);
    assert(testFn.calledTwice);
  });

  it('should propagate the return value of the function', async function () {
    let testFn = sinon.stub();
    testFn.returns('magic value');
    let res = await lock('/tmp/testlock', testFn);
    assert.equal(res, 'magic value');
  });

  it('should raise an error if already locked', async function () {
    let testFn = sinon.spy();
    let promise = lock('/tmp/testlock', () => {
      return lock('/tmp/testlock', testFn);
    });

    await assert.isRejected(promise, lock.LockedError);
    assert(testFn.notCalled);
  });

  it('should propagate + unlock if the function throws an error',
    async function () {
      function testFn () {
        throw Error('Uh oh!');
      }
      let testFn2 = sinon.spy();

      let promise = (async () => {
        await lock('/tmp/testlock', testFn);
        await lock('/tmp/testlock', testFn2);
      })();

      await assert.isRejected(promise, Error, 'Uh oh!');
      assert(testFn2.notCalled);
    }
  );
});
