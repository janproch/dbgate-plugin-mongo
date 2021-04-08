const _ = require('lodash');
const stream = require('stream');
const driverBase = require('../frontend/driver');
const Analyser = require('./Analyser');
const MongoClient = require('mongodb').MongoClient;
const ObjectId = require('mongodb').ObjectId;

const mongoIdRegex = /^[0-9a-f]{24}$/;
function convertCondition(condition) {
  if (condition && _.isString(condition._id) && condition._id.match(mongoIdRegex)) {
    return {
      _id: ObjectId(condition._id),
    };
  }
  return condition;
}

/** @type {import('dbgate-types').EngineDriver} */
const driver = {
  ...driverBase,
  analyserClass: Analyser,
  async connect({ server, port, user, password, database }) {
    let mongoUrl = user ? `mongodb://${user}:${password}@${server}:${port}` : `mongodb://${server}:${port}`;
    if (database) mongoUrl += '/' + database;

    const pool = new MongoClient(mongoUrl);
    await pool.connect();
    // const pool = await MongoClient.connect(mongoUrl);
    return pool;
  },
  // @ts-ignore
  async query(pool, sql) {
    return {
      rows: [],
      columns: [],
    };
  },
  async stream(pool, sql, options) {
    return null;
  },
  async readQuery(pool, sql, structure) {
    const pass = new stream.PassThrough({
      objectMode: true,
      highWaterMark: 100,
    });

    // pass.write(structure)
    // pass.write(row1)
    // pass.write(row2)
    // pass.end()

    return pass;
  },
  async writeTable(pool, name, options) {
    return createBulkInsertStreamBase(this, stream, pool, name, options);
  },
  async getVersion(pool) {
    const status = await pool.db().admin().serverInfo();
    return status;
  },
  async listDatabases(pool) {
    const res = await pool.db().admin().listDatabases();
    return res.databases;
  },
  async readCollection(pool, options) {
    try {
      const collection = pool.db().collection(options.pureName);
      if (options.countDocuments) {
        const count = await collection.countDocuments(options.condition || {});
        return { count };
      } else {
        let cursor = await collection.find(options.condition || {});
        if (options.sort) cursor = cursor.sort(options.sort);
        if (options.skip) cursor = cursor.skip(options.skip);
        if (options.limit) cursor = cursor.limit(options.limit);
        const rows = await cursor.toArray();
        return { rows };
      }
    } catch (err) {
      return { errorMessage: err.message };
    }
  },
  async updateCollection(pool, changeSet) {
    const res = {
      inserted: [],
      updated: [],
      deleted: [],
      replaced: [],
    };
    try {
      const db = pool.db();
      for (const insert of changeSet.inserts) {
        const collection = db.collection(insert.pureName);
        const document = {
          ...insert.document,
          ...insert.fields,
        };
        const resdoc = await collection.insert(document);
        res.inserted.push(resdoc._id);
      }
      for (const update of changeSet.updates) {
        const collection = db.collection(update.pureName);
        if (update.document) {
          const document = {
            ...update.document,
            ...update.fields,
          };
          const doc = await collection.findOne(convertCondition(update.condition));
          if (doc) {
            const resdoc = await collection.replaceOne(convertCondition(update.condition), {
              ...document,
              _id: doc._id,
            });
            res.replaced.push(resdoc._id);
          }
        } else {
          const resdoc = await collection.updateOne(convertCondition(update.condition), { $set: update.fields });
          res.updated.push(resdoc._id);
        }
      }
      for (const del of changeSet.deletes) {
        const collection = db.collection(del.pureName);
        const resdoc = await collection.deleteOne(convertCondition(del.condition));
        res.deleted.push(resdoc._id);
      }
      return res;
    } catch (err) {
      return { errorMessage: err.message };
    }
  },
};

module.exports = driver;
