'use strict';
const Ajv = require('ajv');
const schema = require('../../contracts/package-v1.1.schema.json');
const ajv = new Ajv({ strict: false });
const files = Object.fromEntries(Object.entries(schema.properties).map(([k,v]) => [k, ajv.compile(v)]));
const mapArrays = Object.fromEntries(Object.entries(schema.properties.map.properties).filter(([,v]) => v.type === 'array'));
const items = Object.fromEntries(Object.entries(mapArrays).map(([k,v]) => [k, ajv.compile(v.items)]));
function enforce(validate, value, label) {
    if (!validate(value)) throw new Error(`Schema ${label}: ${ajv.errorsText(validate.errors).slice(0, 240)}`);
}
function mapItem(kind, value) {
    if (!items[kind]) throw new Error('Unknown map array');
    enforce(items[kind], value, kind);
}
function mapHeader(metadata, counts) {
    const value = { ...metadata };
    for (const [key, count] of Object.entries(counts)) {
        if (count > mapArrays[key].maxItems) throw new Error('Map array exceeds Schema limit');
        value[key] = [];
    }
    enforce(files.map, value, 'map');
}
module.exports = { enforce, files, mapItem, mapHeader, report: ajv.compile(require('../../contracts/report.schema.json')) };
