'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The app reads these at require time, so they must be set first.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-demo-master-friends-'));
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-never-deploy';
process.env.UPLOAD_DIR = path.join(tmpRoot, 'uploads');

const app = require('../src/app');
const { db } = require('../src/config/database');

const PASSWORD = 'sup3r-secret-pass';

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
    db.exec(`
        DELETE FROM friendships;
        DELETE FROM lobby_claims;
        DELETE FROM lobbies;
        DELETE FROM user_profiles;
        DELETE FROM users;
    `);
});

// --------------------------------------------------------------------------- //
// helpers
// --------------------------------------------------------------------------- //

async function register(username, nickname) {
    const response = await fetch(`${base}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD, nickname }),
    });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    return body.data;
}

async function request(method, endpoint, { token, body } = {}) {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
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

async function search(token, q, extra = '') {
    return request(
        'GET',
        `/api/v1/users/search?q=${encodeURIComponent(q)}${extra}`,
        { token }
    );
}

async function sendRequest(token, userId) {
    return request('POST', '/api/v1/friends/requests', {
        token,
        body: { user_id: userId },
    });
}

async function acceptRequest(token, requestId) {
    return request('POST', `/api/v1/friends/requests/${requestId}/accept`, { token });
}

async function rejectRequest(token, requestId) {
    return request('POST', `/api/v1/friends/requests/${requestId}/reject`, { token });
}

async function cancelRequest(token, requestId) {
    return request('DELETE', `/api/v1/friends/requests/${requestId}`, { token });
}

async function listFriends(token, query = '') {
    return request('GET', `/api/v1/friends${query}`, { token });
}

async function listRequests(token) {
    return request('GET', '/api/v1/friends/requests', { token });
}

async function befriend(first, second) {
    const sent = await sendRequest(first.access_token, second.user.id);
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    const accepted = await acceptRequest(second.access_token, sent.body.data.id);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    return accepted;
}

// --------------------------------------------------------------------------- //
// schema / auth
// --------------------------------------------------------------------------- //

test('the friendships table stores a canonical pair and request state', () => {
    const columns = db
        .prepare('PRAGMA table_info(friendships)')
        .all()
        .map((column) => column.name);

    for (const name of [
        'id',
        'user_low_id',
        'user_high_id',
        'requester_id',
        'status',
        'created_at',
        'updated_at',
        'accepted_at',
    ]) {
        assert.ok(columns.includes(name), `friendships is missing the ${name} column`);
    }
});

test('every friend endpoint requires authentication', async () => {
    const endpoints = [
        ['GET', '/api/v1/friends'],
        ['GET', '/api/v1/friends/requests'],
        ['POST', '/api/v1/friends/requests'],
        ['POST', '/api/v1/friends/requests/1/accept'],
        ['POST', '/api/v1/friends/requests/1/reject'],
        ['DELETE', '/api/v1/friends/requests/1'],
        ['DELETE', '/api/v1/friends/1'],
        ['GET', '/api/v1/users/search?q=bob'],
    ];

    for (const [method, endpoint] of endpoints) {
        const result = await request(method, endpoint);
        assert.equal(result.status, 401, `${method} ${endpoint}`);
        assert.equal(result.body.code, 40002, `${method} ${endpoint}`);
    }
});

// --------------------------------------------------------------------------- //
// search
// --------------------------------------------------------------------------- //

test('user search returns matching public summaries and validates input', async () => {
    const alice = await register('alice', 'Alice');
    const bob = await register('bob', 'Bobby');
    const carol = await register('carol', 'Carol');

    const updated = await request('PATCH', '/api/v1/users/me/profile', {
        token: bob.access_token,
        body: { skill_level: '完美 C+', signature: 'AWP main' },
    });
    assert.equal(updated.status, 200);

    const result = await search(alice.access_token, 'bo');
    assert.equal(result.status, 200);
    assert.equal(result.body.data.total, 1);
    assert.equal(result.body.data.page, 1);
    assert.equal(result.body.data.pageSize, 20);
    const found = result.body.data.items[0];
    assert.equal(found.user_id, bob.user.id);
    assert.equal(found.username, 'bob');
    assert.equal(found.nickname, 'Bobby');
    assert.equal(found.skill_level, '完美 C+');
    assert.equal(found.signature, 'AWP main');
    assert.equal(found.relationship, 'none');

    const caseInsensitive = await search(alice.access_token, 'BO');
    assert.equal(caseInsensitive.body.data.total, 1);
    assert.equal(caseInsensitive.body.data.items[0].username, 'bob');

    const selfOnly = await search(alice.access_token, 'ali');
    assert.equal(selfOnly.body.data.total, 0);

    const escapedWildcard = await search(alice.access_token, '%%');
    assert.equal(escapedWildcard.body.data.total, 0);

    const nicknameSearch = await search(alice.access_token, 'rol');
    assert.equal(nicknameSearch.body.data.total, 1);
    assert.equal(nicknameSearch.body.data.items[0].username, 'carol');

    const invalidQueries = [
        'q=a',
        'q=',
        `q=${'x'.repeat(33)}`,
        'q=bo&page=0',
        'q=bo&pageSize=51',
        'q=bo&page=1.5',
    ];
    for (const query of invalidQueries) {
        const bad = await request('GET', `/api/v1/users/search?${query}`, {
            token: alice.access_token,
        });
        assert.equal(bad.status, 400, query);
        assert.equal(bad.body.code, 40000, query);
    }

    const missingQ = await request('GET', '/api/v1/users/search', {
        token: alice.access_token,
    });
    assert.equal(missingQ.status, 400);
    assert.equal(missingQ.body.code, 40000);
});

test('search exposes none, incoming, outgoing and friend relationships', async () => {
    const alice = await register('alice');
    const bob = await register('bob');

    const before = await search(alice.access_token, 'bo');
    assert.equal(before.body.data.items[0].relationship, 'none');

    const sent = await sendRequest(alice.access_token, bob.user.id);
    assert.equal(sent.status, 201);

    const outgoing = await search(alice.access_token, 'bo');
    assert.equal(outgoing.body.data.items[0].relationship, 'outgoing_request');
    const incoming = await search(bob.access_token, 'ali');
    assert.equal(incoming.body.data.items[0].relationship, 'incoming_request');

    const accepted = await acceptRequest(bob.access_token, sent.body.data.id);
    assert.equal(accepted.status, 200);

    const friend = await search(alice.access_token, 'bo');
    assert.equal(friend.body.data.items[0].relationship, 'friend');

    const removed = await request('DELETE', `/api/v1/friends/${bob.user.id}`, {
        token: alice.access_token,
    });
    assert.equal(removed.status, 200);

    const after = await search(alice.access_token, 'bo');
    assert.equal(after.body.data.items[0].relationship, 'none');
});

// --------------------------------------------------------------------------- //
// send / list requests
// --------------------------------------------------------------------------- //

test('sending a friend request validates the target and prevents duplicates', async () => {
    const alice = await register('alice');
    const bob = await register('bob');

    const sent = await sendRequest(alice.access_token, bob.user.id);
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.equal(sent.body.data.status, 'pending');
    assert.equal(sent.body.data.direction, 'outgoing');
    assert.equal(sent.body.data.user.username, 'bob');
    assert.ok(sent.body.data.created_at);

    const row = db
        .prepare('SELECT * FROM friendships WHERE user_low_id = ? AND user_high_id = ?')
        .get(Math.min(alice.user.id, bob.user.id), Math.max(alice.user.id, bob.user.id));
    assert.equal(row.requester_id, alice.user.id);
    assert.equal(row.status, 'pending');

    const duplicate = await sendRequest(alice.access_token, bob.user.id);
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, 40900);

    const reverse = await sendRequest(bob.access_token, alice.user.id);
    assert.equal(reverse.status, 409);
    assert.equal(reverse.body.code, 40900);

    const self = await sendRequest(alice.access_token, alice.user.id);
    assert.equal(self.status, 400);
    assert.equal(self.body.code, 40000);

    const unknown = await sendRequest(alice.access_token, 9999);
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.code, 40400);

    const invalidBodies = [undefined, {}, { user_id: '2' }, { user_id: 1, extra: true }];
    for (const body of invalidBodies) {
        const result = await request('POST', '/api/v1/friends/requests', {
            token: alice.access_token,
            body,
        });
        assert.equal(result.status, 400, JSON.stringify(body));
        assert.equal(result.body.code, 40000, JSON.stringify(body));
    }
});

test('request lists split incoming and outgoing and count incoming', async () => {
    const alice = await register('alice');
    const bob = await register('bob');
    const carol = await register('carol');

    await sendRequest(alice.access_token, bob.user.id);
    await sendRequest(carol.access_token, bob.user.id);

    const asBob = await listRequests(bob.access_token);
    assert.equal(asBob.status, 200);
    assert.equal(asBob.body.data.incoming_count, 2);
    assert.equal(asBob.body.data.incoming.length, 2);
    assert.equal(asBob.body.data.outgoing.length, 0);
    assert.deepEqual(
        asBob.body.data.incoming.map((item) => item.direction),
        ['incoming', 'incoming']
    );

    const asAlice = await listRequests(alice.access_token);
    assert.equal(asAlice.body.data.incoming_count, 0);
    assert.equal(asAlice.body.data.incoming.length, 0);
    assert.equal(asAlice.body.data.outgoing.length, 1);
    assert.equal(asAlice.body.data.outgoing[0].user.username, 'bob');
    assert.equal(asAlice.body.data.outgoing[0].direction, 'outgoing');
});

// --------------------------------------------------------------------------- //
// accept / reject / cancel
// --------------------------------------------------------------------------- //

test('only the recipient can accept and both users see the friendship', async () => {
    const alice = await register('alice');
    const bob = await register('bob');
    const carol = await register('carol');

    const sent = await sendRequest(alice.access_token, bob.user.id);
    const requestId = sent.body.data.id;

    const requesterAccept = await acceptRequest(alice.access_token, requestId);
    assert.equal(requesterAccept.status, 403);
    assert.equal(requesterAccept.body.code, 40300);

    const outsiderAccept = await acceptRequest(carol.access_token, requestId);
    assert.equal(outsiderAccept.status, 404);
    assert.equal(outsiderAccept.body.code, 40400);

    const accepted = await acceptRequest(bob.access_token, requestId);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.data.status, 'accepted');
    assert.equal(accepted.body.data.user.username, 'alice');
    assert.ok(accepted.body.data.accepted_at);

    const aliceFriends = await listFriends(alice.access_token);
    assert.equal(aliceFriends.status, 200);
    assert.equal(aliceFriends.body.data.total, 1);
    assert.equal(aliceFriends.body.data.items[0].user.username, 'bob');
    assert.ok(aliceFriends.body.data.items[0].friends_since);
    assert.ok(aliceFriends.body.data.items[0].friendship_id);

    const bobFriends = await listFriends(bob.access_token);
    assert.equal(bobFriends.body.data.total, 1);
    assert.equal(bobFriends.body.data.items[0].user.username, 'alice');

    assert.equal((await listRequests(alice.access_token)).body.data.outgoing.length, 0);
    assert.equal((await listRequests(bob.access_token)).body.data.incoming.length, 0);

    const acceptedAgain = await acceptRequest(bob.access_token, requestId);
    assert.equal(acceptedAgain.status, 409);
    assert.equal(acceptedAgain.body.code, 40900);

    const cancelAccepted = await cancelRequest(alice.access_token, requestId);
    assert.equal(cancelAccepted.status, 409);
    assert.equal(cancelAccepted.body.code, 40900);
});

test('the recipient can reject and the sender can request again later', async () => {
    const alice = await register('alice');
    const bob = await register('bob');

    const sent = await sendRequest(alice.access_token, bob.user.id);
    const requestId = sent.body.data.id;

    const requesterReject = await rejectRequest(alice.access_token, requestId);
    assert.equal(requesterReject.status, 403);

    const rejected = await rejectRequest(bob.access_token, requestId);
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.data.status, 'rejected');
    assert.equal(
        db.prepare('SELECT COUNT(*) AS total FROM friendships').get().total,
        0
    );

    assert.equal((await listFriends(alice.access_token)).body.data.total, 0);
    assert.equal((await listRequests(bob.access_token)).body.data.incoming.length, 0);

    const again = await sendRequest(alice.access_token, bob.user.id);
    assert.equal(again.status, 201);
    assert.notEqual(again.body.data.id, requestId);
});

test('only the sender can cancel a pending request', async () => {
    const alice = await register('alice');
    const bob = await register('bob');
    const carol = await register('carol');

    const sent = await sendRequest(alice.access_token, bob.user.id);
    const requestId = sent.body.data.id;

    const recipientCancel = await cancelRequest(bob.access_token, requestId);
    assert.equal(recipientCancel.status, 403);

    const outsiderCancel = await cancelRequest(carol.access_token, requestId);
    assert.equal(outsiderCancel.status, 404);

    const cancelled = await cancelRequest(alice.access_token, requestId);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.data.status, 'cancelled');

    assert.equal(
        db.prepare('SELECT COUNT(*) AS total FROM friendships').get().total,
        0
    );
    assert.equal((await listRequests(bob.access_token)).body.data.incoming.length, 0);

    const again = await cancelRequest(alice.access_token, requestId);
    assert.equal(again.status, 404);
    assert.equal(again.body.code, 40400);
});

// --------------------------------------------------------------------------- //
// friend list / remove
// --------------------------------------------------------------------------- //

test('the friend list is paginated and only contains my friends', async () => {
    const alice = await register('alice');
    const bob = await register('bob');
    const carol = await register('carol');
    const dave = await register('dave');
    const erin = await register('erin');

    await befriend(alice, bob);
    await befriend(alice, carol);
    await befriend(alice, dave);

    const firstPage = await listFriends(alice.access_token, '?page=1&pageSize=2');
    assert.equal(firstPage.status, 200);
    assert.equal(firstPage.body.data.page, 1);
    assert.equal(firstPage.body.data.pageSize, 2);
    assert.equal(firstPage.body.data.total, 3);
    assert.equal(firstPage.body.data.items.length, 2);

    const secondPage = await listFriends(alice.access_token, '?page=2&pageSize=2');
    assert.equal(secondPage.body.data.total, 3);
    assert.equal(secondPage.body.data.items.length, 1);

    const allIds = [
        ...firstPage.body.data.items.map((item) => item.user.user_id),
        ...secondPage.body.data.items.map((item) => item.user.user_id),
    ].sort((a, b) => a - b);
    assert.deepEqual(
        allIds,
        [bob.user.id, carol.user.id, dave.user.id].sort((a, b) => a - b)
    );

    const erinFriends = await listFriends(erin.access_token);
    assert.equal(erinFriends.body.data.total, 0);

    const badPage = await listFriends(alice.access_token, '?page=0');
    assert.equal(badPage.status, 400);
    assert.equal(badPage.body.code, 40000);
});

test('removing a friend deletes the relationship for both users and allows a new request', async () => {
    const alice = await register('alice');
    const bob = await register('bob');
    const carol = await register('carol');

    await befriend(alice, bob);

    const removed = await request('DELETE', `/api/v1/friends/${bob.user.id}`, {
        token: alice.access_token,
    });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.data, { user_id: bob.user.id });

    assert.equal((await listFriends(alice.access_token)).body.data.total, 0);
    assert.equal((await listFriends(bob.access_token)).body.data.total, 0);

    const again = await request('DELETE', `/api/v1/friends/${bob.user.id}`, {
        token: alice.access_token,
    });
    assert.equal(again.status, 404);
    assert.equal(again.body.code, 40400);

    const self = await request('DELETE', `/api/v1/friends/${alice.user.id}`, {
        token: alice.access_token,
    });
    assert.equal(self.status, 400);
    assert.equal(self.body.code, 40000);

    const notFriend = await request('DELETE', `/api/v1/friends/${carol.user.id}`, {
        token: alice.access_token,
    });
    assert.equal(notFriend.status, 404);

    const newRequest = await sendRequest(alice.access_token, bob.user.id);
    assert.equal(newRequest.status, 201);
});
