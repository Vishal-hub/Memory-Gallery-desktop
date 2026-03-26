const { createDb } = require('./indexer/db');
const { runIndexing } = require('./indexer/index-service');
const { getEventsForRenderer, getIndexStats } = require('./indexer/repository');

module.exports = {
  createDb,
  runIndexing,
  getEventsForRenderer,
  getIndexStats,
};
