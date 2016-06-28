'use strict';

let sinon = require('sinon');
let lock = require('../server/lib/lock');
let chai = require('chai');
let chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
let assert = chai.assert;

describe('File locking system', function() {
  it('should call provided function', function() {
    let testFn = sinon.spy();
    return lock('/tmp/testlock', testFn)
      .then(() => {
        assert(testFn.called);
      });
  });

  it('should unlock after calling the function', function() {
    let testFn = sinon.spy();
    return lock('/tmp/testlock', testFn)
      .then(() => lock('/tmp/testlock', testFn))
      .then(() => {
        assert(testFn.calledTwice);
      });
  });

  it('should raise an error if already locked', function() {
    let testFn = sinon.spy();
    let promise = lock('/tmp/testlock', () => {
      return lock('/tmp/testlock', testFn);
    });

    return assert.isRejected(promise, lock.LockedError)
      .then(() => {
        assert(testFn.notCalled);
      });
  });

  it('should propagate + unlock if the function throws an error', function() {
    function testFn() {
      throw Error('Uh oh!');
    }
    let testFn2 = sinon.spy();

    let promise = lock('/tmp/testlock', testFn)
      .then(() => lock('/tmp/testlock', testFn2));
    return assert.isRejected(promise, Error, 'Uh oh!')
      .then(() => {
        assert(testFn2.notCalled);
      });
  });
});
