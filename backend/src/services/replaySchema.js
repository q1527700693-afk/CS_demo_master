'use strict';
const Ajv = require('ajv');
const ajv = new Ajv({ strict: false });
const versions = {};
for (const version of ['1.1.0', '1.2.0']) {
    const schema = require(`../../contracts/package-v${version.slice(0, 3)}.schema.json`);
    const files = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, ajv.compile(v)]));
    const arrays = {}, items = {};
    for (const name of ['map', 'events']) {
        arrays[name] = Object.fromEntries(Object.entries(schema.properties[name].properties).filter(([, v]) => v.type === 'array'));
        items[name] = Object.fromEntries(Object.entries(arrays[name]).map(([k, v]) => [k, ajv.compile(v.items)]));
    }
    versions[version] = { files, arrays, items };
}
function enforce(validate, value, label) {
    if (!validate(value)) throw new Error(`Schema ${label}: ${ajv.errorsText(validate.errors).slice(0, 240)}`);
}
function forVersion(version) {
    if (!Object.hasOwn(versions, version)) throw new Error('Unsupported document envelope version');
    return versions[version];
}
function item(name, kind, value, version) {
    const validate = forVersion(version).items[name][kind];
    if (!validate) throw new Error(`Unknown ${name} array`);
    enforce(validate, value, kind);
}
function header(name, metadata, counts, version) {
    const validators = forVersion(version), value = { ...metadata };
    for (const [key, count] of Object.entries(counts)) {
        const rule = validators.arrays[name][key];
        if (!rule || count > (rule.maxItems ?? Infinity) || count < (rule.minItems ?? 0)) throw new Error(`${name} array exceeds Schema limit`);
        value[key] = [];
    }
    enforce(validators.files[name], value, name);
}
module.exports = { enforce, forVersion, item, header, report: ajv.compile(require('../../contracts/report.schema.json')) };
