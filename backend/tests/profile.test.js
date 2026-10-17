'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

// The app reads these at require time, so they must be set first.
const tmpRoot = path.join(__dirname, '_tmp');
fs.rmSync(tmpRoot, { recursive: true, force: true });
fs.mkdirSync(tmpRoot, { recursive: true });

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-never-deploy';
process.env.UPLOAD_DIR = path.join(tmpRoot, 'uploads');

const app = require('../src/app');
const { db } = require('../src/config/database');

const PASSWORD = 'sup3r-secret-pass';
const STEAM_ID = '76561198000000001';

let server;
let base;

test.before(async () => {
    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test.beforeEach(() => {
    db.exec('DELETE FROM user_profiles; DELETE FROM users;');
});

// --------------------------------------------------------------------------- //
// helpers
// --------------------------------------------------------------------------- //

async function register(username, password = PASSWORD) {
    const response = await fetch(`${base}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    return body.data;
}

function auth(token) {
    return { authorization: `Bearer ${token}` };
}

async function request(method, endpoint, { token, body } = {}) {
    const headers = token ? auth(token) : {};
    if (body !== undefined) {
        headers['content-type'] = 'application/json';
    }
    const response = await fetch(`${base}${endpoint}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
}

async function uploadAvatar(token, buffer, filename = 'avatar.png', type = 'image/png') {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type }), filename);

    const response = await fetch(`${base}/api/v1/users/me/avatar`, {
        method: 'POST',
        headers: token ? auth(token) : {},
        body: form,
    });
    return { status: response.status, body: await response.json() };
}

function avatarPng(width = 900, height = 600) {
    return sharp({
        create: { width, height, channels: 3, background: '#2b6cb0' },
    })
        .png()
        .toBuffer();
}

async function noisePng(width, height) {
    const channels = 3;
    const raw = Buffer.alloc(width * height * channels);
    for (let index = 0; index < raw.length; index += 1) {
        raw[index] = Math.floor(Math.random() * 256);
    }
    return sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
}

function uploadedFile(url) {
    return path.join(process.env.UPLOAD_DIR, url.replace('/uploads/', ''));
}

// --------------------------------------------------------------------------- //
// account
// --------------------------------------------------------------------------- //

test('health check answers with the envelope', async () => {
    const { status, body } = await request('GET', '/api/v1/health');
    assert.equal(status, 200);
    assert.deepEqual(body, { code: 0, message: 'success', data: { status: 'ok' } });
});

test('register returns a token and the account', async () => {
    const data = await register('alice');
    assert.ok(data.access_token);
    assert.equal(data.user.username, 'alice');

    const me = await request('GET', '/api/v1/users/me', { token: data.access_token });
    assert.equal(me.status, 200);
    assert.equal(me.body.data.username, 'alice');
});

test('register rejects a duplicate username', async () => {
    await register('alice');
    const { status, body } = await request('POST', '/api/v1/auth/register', {
        body: { username: 'alice', password: PASSWORD },
    });
    assert.equal(status, 409);
    assert.equal(body.code, 40900);
});

test('protected endpoints reject a missing token', async () => {
    const { status, body } = await request('GET', '/api/v1/users/me/profile');
    assert.equal(status, 401);
    assert.equal(body.code, 40002);
});

// --------------------------------------------------------------------------- //
// personal card
// --------------------------------------------------------------------------- //

test('a fresh account has an empty card', async () => {
    const { access_token: token } = await register('alice');
    const { body } = await request('GET', '/api/v1/users/me/profile', { token });

    assert.equal(body.code, 0);
    assert.equal(body.data.username, 'alice');
    assert.equal(body.data.has_platform_id, false);
    assert.equal(body.data.steam_id, null);
    assert.equal(body.data.wanmei_id, null);
    assert.equal(body.data['5E_id'], null);
    assert.equal(body.data.signature, null);
    assert.equal(body.data.avatar_url, null);
});

test('updating only the signature is rejected', async () => {
    const { access_token: token } = await register('alice');
    const { status, body } = await request('PATCH', '/api/v1/users/me/profile', {
        token,
        body: { signature: 'hello' },
    });
    assert.equal(status, 400);
    assert.equal(body.code, 40000);
    assert.match(body.message, /at least one platform id/);
});

test('steam ids are normalised to SteamID64', async () => {
    const { access_token: token } = await register('alice');
    const { status, body } = await request('PATCH', '/api/v1/users/me/profile', {
        token,
        body: { steam_id: '[U:1:12345]' },
    });
    assert.equal(status, 200);
    assert.equal(body.data.steam_id, '76561197960278073');
    assert.equal(body.data.has_platform_id, true);
});

test('the whole card can be filled at once', async () => {
    const { access_token: token } = await register('alice');
    const { body } = await request('PATCH', '/api/v1/users/me/profile', {
        token,
        body: {
            steam_id: STEAM_ID,
            wanmei_id: 'PW_10086',
            '5E_id': '8899',
            signature: '主玩狙击，周末开黑',
            skill_level: '完美 C+',
            looking_for: '想找固定车队',
            other_game_ids: [{ game: 'Faceit', account: 'alice_f' }],
        },
    });

    assert.equal(body.data.steam_id, STEAM_ID);
    assert.equal(body.data.wanmei_id, 'PW_10086');
    assert.equal(body.data['5E_id'], '8899');
    assert.equal(body.data.signature, '主玩狙击，周末开黑');
    assert.equal(body.data.skill_level, '完美 C+');
    assert.equal(body.data.looking_for, '想找固定车队');
    assert.deepEqual(body.data.other_game_ids, [{ game: 'Faceit', account: 'alice_f' }]);
    assert.equal(body.data.has_platform_id, true);
    assert.ok(!('five_e_id' in body.data));
});

test('5E_id also accepts the five_e_id spelling', async () => {
    const { access_token: token } = await register('alice');
    const { body } = await request('PATCH', '/api/v1/users/me/profile', {
        token,
        body: { five_e_id: '12345' },
    });
    assert.equal(body.data['5E_id'], '12345');
});

test('bio is accepted as an alias of signature', async () => {
    const { access_token: token } = await register('alice');
    const { body } = await request('PATCH', '/api/v1/users/me/profile', {
        token,
        body: { steam_id: STEAM_ID, bio: 'written through the column name' },
    });
    assert.equal(body.data.signature, 'written through the column name');
});

test('the table follows the TASKS.md 4.2 column names', () => {
    const columns = db
        .prepare('PRAGMA table_info(user_profiles)')
        .all()
        .map((column) => column.name);

    for (const name of [
        'bio',
        'steam_id',
        'wanmei_id',
        'five_e_id',
        'other_game_ids',
        'skill_level',
        'looking_for',
    ]) {
        assert.ok(columns.includes(name), `user_profiles is missing the ${name} column`);
    }
});

test('invalid input is rejected with 40000', async () => {
    const { access_token: token } = await register('alice');

    const cases = [
        { signature: 'x'.repeat(201), steam_id: STEAM_ID },
        { steam_id: 'not-a-steam-id' },
        { steam_id: STEAM_ID, wanmei_id: 'a' },
        { steam_id: STEAM_ID, '5E_id': 'bad id' },
        { steam_id: STEAM_ID, skill_level: 'x'.repeat(33) },
        { steam_id: STEAM_ID, other_game_ids: 'nope' },
        { steam_id: STEAM_ID, unknown_field: true },
        {},
    ];

    for (const body of cases) {
        const result = await request('PATCH', '/api/v1/users/me/profile', { token, body });
        assert.equal(result.status, 400, JSON.stringify(body));
        assert.equal(result.body.code, 40000, JSON.stringify(body));
    }
});

test('a platform id belongs to a single account', async () => {
    const alice = await register('alice');
    const bob = await register('bob');

    await request('PATCH', '/api/v1/users/me/profile', {
        token: alice.access_token,
        body: { steam_id: STEAM_ID },
    });

    const { status, body } = await request('PATCH', '/api/v1/users/me/profile', {
        token: bob.access_token,
        body: { steam_id: STEAM_ID },
    });
    assert.equal(status, 409);
    assert.equal(body.code, 40900);
});

test('clearing every platform id leaves the card untouched', async () => {
    const { access_token: token } = await register('alice');
    await request('PATCH', '/api/v1/users/me/profile', {
        token,
        body: { steam_id: STEAM_ID, signature: 'keep me' },
    });

    const cleared = await request('PATCH', '/api/v1/users/me/profile', {
        token,
        body: { steam_id: null },
    });
    assert.equal(cleared.status, 400);
    assert.equal(cleared.body.code, 40000);

    const card = await request('GET', '/api/v1/users/me/profile', { token });
    assert.equal(card.body.data.steam_id, STEAM_ID);
    assert.equal(card.body.data.signature, 'keep me');
});

test('the public card is readable without a token', async () => {
    const { access_token: token, user } = await register('alice');
    await request('PATCH', '/api/v1/users/me/profile', {
        token,
        body: { steam_id: STEAM_ID, signature: 'hello' },
    });

    const { status, body } = await request('GET', `/api/v1/users/${user.id}/profile`);
    assert.equal(status, 200);
    assert.equal(body.data.username, 'alice');
    assert.equal(body.data.steam_id, STEAM_ID);
});

test('an unknown public card is not found', async () => {
    const { status, body } = await request('GET', '/api/v1/users/9999/profile');
    assert.equal(status, 404);
    assert.equal(body.code, 40400);
});

// --------------------------------------------------------------------------- //
// avatar
// --------------------------------------------------------------------------- //

test('the avatar is resized to 512x512 and stored outside the database', async () => {
    const { access_token: token, user } = await register('alice');

    const { status, body } = await uploadAvatar(token, await avatarPng(900, 600));
    assert.equal(status, 200, JSON.stringify(body));
    assert.match(body.data.avatar_url, new RegExp(`^/uploads/avatars/${user.id}/`));
    assert.equal(body.data.content_type, 'image/jpeg');
    assert.equal(body.data.width, 512);
    assert.equal(body.data.height, 512);

    const stored = uploadedFile(body.data.avatar_url);
    assert.ok(fs.existsSync(stored), 'resized avatar should exist on disk');
    const metadata = await sharp(stored).metadata();
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
    assert.equal(metadata.format, 'jpeg');

    const served = await fetch(`${base}${body.data.avatar_url}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/jpeg');
    assert.equal(served.headers.get('x-content-type-options'), 'nosniff');

    const card = await request('GET', '/api/v1/users/me/profile', { token });
    assert.equal(card.body.data.avatar_url, body.data.avatar_url);
});

test('a new avatar replaces and deletes the previous file', async () => {
    const { access_token: token } = await register('alice');

    const first = await uploadAvatar(token, await avatarPng());
    const second = await uploadAvatar(token, await avatarPng(600, 600));

    assert.notEqual(first.body.data.avatar_url, second.body.data.avatar_url);
    assert.equal(fs.existsSync(uploadedFile(first.body.data.avatar_url)), false);
    assert.equal(fs.existsSync(uploadedFile(second.body.data.avatar_url)), true);
});

test('an avatar larger than 2 MB is rejected', async () => {
    const { access_token: token } = await register('alice');
    const big = await noisePng(1400, 1400);
    assert.ok(big.length > 2 * 1024 * 1024, `fixture should exceed 2 MB, got ${big.length}`);

    const { status, body } = await uploadAvatar(token, big);
    assert.equal(status, 413);
    assert.equal(body.code, 41300);
});

test('a non image upload is rejected', async () => {
    const { access_token: token } = await register('alice');
    const { status, body } = await uploadAvatar(token, Buffer.from('#!/bin/sh\necho nope\n'));
    assert.equal(status, 400);
    assert.equal(body.code, 40000);
});

test('avatar upload requires a token', async () => {
    const { status, body } = await uploadAvatar(undefined, await avatarPng());
    assert.equal(status, 401);
    assert.equal(body.code, 40002);
});

test('deleting the avatar removes the file and the reference', async () => {
    const { access_token: token } = await register('alice');
    const uploaded = await uploadAvatar(token, await avatarPng());
    const stored = uploadedFile(uploaded.body.data.avatar_url);
    assert.ok(fs.existsSync(stored));

    const deleted = await request('DELETE', '/api/v1/users/me/avatar', { token });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.data.avatar_url, null);
    assert.equal(fs.existsSync(stored), false);
});
