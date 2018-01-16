'use strict';

const Ajv = require('ajv');
const fs = require('fs');
const path = require('path');
const inspect = require('util').inspect;

class ConfigValidator {
  constructor (dir) {
    this.dir = dir;
    this.ajv = new Ajv({allErrors: true, jsonPointers: true});
    this.patterns = [];
    this.errors = [];
  }

  addSchema (schemaName, pattern) {
    const schemaPath = path.join(this.dir, `${schemaName}.json`);
    const schema = JSON.parse(fs.readFileSync(schemaPath));

    this.ajv.addSchema(schema, schemaName);

    if (pattern) {
      this.patterns.push([pattern, schemaName]);
    }
  }

  async validate (fileName, data) {
    this.errors = [];

    const match = this.patterns.find(([pattern, _name]) => {
      return (fileName.match(pattern) !== null);
    });
    if (!match) {
      // Not one of the files that needs to be validated
      return true;
    }

    let json;
    try {
      json = JSON.parse(data);
    } catch (err) {
      if (err instanceof SyntaxError) {
        this.errors.push(`File ${fileName} is not proper JSON`);
        return false;
      } else {
        throw err;
      }
    }

    if (!this.ajv.validate(match[1], json)) {
      for (const err of this.ajv.errors) {
        const params = inspect(err.params, {depth: null});
        const path = err.dataPath || 'root';
        const strErr = `${path} ${err.message} (${params})`;
        this.errors.push(`File ${fileName} invalid format: ` + strErr);
      }
      return false;
    }

    return true;
  }
}

module.exports = ConfigValidator;
