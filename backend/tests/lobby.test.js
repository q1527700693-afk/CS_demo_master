'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The app reads these at require time, so they must be set first.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-demo-master-lobby-'));
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-never-deploy';
process.env.UPLOAD_DIR = path.join(tmpRoot, 'uploads');

const app = require('../src/app');
const { db } = require('../src/config/database');

const PASSWORD = 'sup3r-secret-pass';
const TEAM_CODE = 'CS2-MIRAGE-8899';

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

const LOBBY_BODY = Object.freeze({
    title: 'Mirage 4缺1',
    description: 'AWP main, looking for a support player.',
    mode: 'premier',
    map: 'Mirage',
    region: 'Asia',
    skill_level: '完美 C+',
    team_size: 5,
    current_players: 4,
    team_code: TEAM_CODE,
});

async function createLobby(token, overrides = {}) {
    return request('POST', '/api/v1/lobbies', {
        token,
        body: { ...LOBBY_BODY, ...overrides },
    });
}

async function claim(token, id) {
    return request('POST', `/api/v1/lobbies/${id}/claim`, { token });
}

async function cancel(token, id) {
    return request('DELETE', `/api/v1/lobbies/${id}/claim`, { token });
}

// --------------------------------------------------------------------------- //
// schema
// --------------------------------------------------------------------------- //

test('the lobby tables store a declared roster, a code and virtual claims', () => {
    const lobbyColumns = db
        .prepare('PRAGMA table_info(lobbies)')
        .all()
        .map((column) => column.name);
    const claimColumns = db
        .prepare('PRAGMA table_info(lobby_claims)')
        .all()
        .map((column) => column.name);

    for (const name of [
        'owner_id',
        'title',
        'team_size',
        'current_players',
        'team_code',
        'expires_at',
        'departed_at',
        'created_at',
    ]) {
        assert.ok(lobbyColumns.includes(name), `lobbies is missing the ${name} column`);
    }
    for (const name of ['lobby_id', 'user_id', 'claimed_at', 'status', 'kicked_at']) {
        assert.ok(claimColumns.includes(name), `lobby_claims is missing the ${name} column`);
    }
});

// --------------------------------------------------------------------------- //
// create
// --------------------------------------------------------------------------- //

test('creating a lobby requires an account', async () => {
    const { status, body } = await createLobby(undefined);
    assert.equal(status, 401);
    assert.equal(body.code, 40002);
});

test('the owner publishes a 4/5 team plus its team code', async () => {
    const alice = await register('alice', 'Alice');

    const { status, body } = await createLobby(alice.access_token);
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(body.code, 0);

    const lobby = body.data;
    assert.equal(lobby.title, 'Mirage 4缺1');
    assert.equal(lobby.mode, 'premier');
    assert.equal(lobby.team_size, 5);
    assert.equal(lobby.current_players, 4);
    assert.equal(lobby.slots_needed, 1);
    assert.equal(lobby.claim_count, 0);
    assert.deepEqual(lobby.claimants, []);
    assert.equal(lobby.status, 'open');
    assert.equal(lobby.departed_at, null);
    assert.equal(lobby.team_code, TEAM_CODE);
    assert.equal(lobby.owner_id, alice.user.id);
    assert.equal(lobby.owner.username, 'alice');
    assert.equal(lobby.is_owner, true);
    assert.equal(lobby.is_claimed, false);
    assert.equal(lobby.can_claim, false);
    assert.ok(lobby.expires_at > lobby.created_at);
    assert.ok(
        new Date(lobby.expires_at).getTime() - new Date(lobby.created_at).getTime() <=
            25 * 60 * 60 * 1000
    );

    const row = db.prepare('SELECT * FROM lobbies WHERE id = ?').get(lobby.id);
    assert.equal(row.team_code, TEAM_CODE);
    assert.equal(row.current_players, 4);
});

test('invalid lobby input is rejected with 40000', async () => {
    const alice = await register('alice');
    const token = alice.access_token;

    const cases = [
        undefined,
        {},
        { ...LOBBY_BODY, title: '   ' },
        { ...LOBBY_BODY, title: 'x'.repeat(61) },
        { ...LOBBY_BODY, description: 'x'.repeat(301) },
        { ...LOBBY_BODY, mode: 'deathmatch' },
        { ...LOBBY_BODY, team_size: undefined },
        { ...LOBBY_BODY, team_size: 1 },
        { ...LOBBY_BODY, team_size: 11 },
        { ...LOBBY_BODY, team_size: '5' },
        { ...LOBBY_BODY, current_players: undefined },
        { ...LOBBY_BODY, current_players: 0 },
        { ...LOBBY_BODY, current_players: 5 },
        { ...LOBBY_BODY, current_players: 6 },
        { ...LOBBY_BODY, current_players: '4' },
        { ...LOBBY_BODY, team_code: undefined },
        { ...LOBBY_BODY, team_code: null },
        { ...LOBBY_BODY, team_code: 'ABC' },
        { ...LOBBY_BODY, team_code: 'x'.repeat(65) },
        { ...LOBBY_BODY, team_code: 'bad\ncode' },
        { ...LOBBY_BODY, unknown_field: true },
        { ...LOBBY_BODY, map: 'x'.repeat(33) },
        { ...LOBBY_BODY, region: 'x'.repeat(33) },
        { ...LOBBY_BODY, skill_level: 'x'.repeat(33) },
        [],
    ];

    for (const body of cases) {
        const result = await request('POST', '/api/v1/lobbies', { token, body });
        assert.equal(result.status, 400, JSON.stringify(body));
        assert.equal(result.body.code, 40000, JSON.stringify(body));
    }
});

// --------------------------------------------------------------------------- //
// hall and detail
// --------------------------------------------------------------------------- //

test('the hall is public, paginated, newest first and filtered by mode', async () => {
    const alice = await register('alice');
    await createLobby(alice.access_token, { title: 'first' });
    await createLobby(alice.access_token, { title: 'second', mode: 'premier' });
    await createLobby(alice.access_token, {
        title: 'third',
        mode: 'wingman',
        team_size: 2,
        current_players: 1,
    });

    const firstPage = await request('GET', '/api/v1/lobbies?page=1&pageSize=2');
    assert.equal(firstPage.status, 200);
    assert.equal(firstPage.body.data.page, 1);
    assert.equal(firstPage.body.data.pageSize, 2);
    assert.equal(firstPage.body.data.total, 3);
    assert.deepEqual(
        firstPage.body.data.items.map((lobby) => lobby.title),
        ['third', 'second']
    );
    assert.equal(firstPage.body.data.items[0].current_players, 1);
    assert.equal(firstPage.body.data.items[0].slots_needed, 1);
    assert.equal(firstPage.body.data.items[0].team_code, null);

    const secondPage = await request('GET', '/api/v1/lobbies?page=2&pageSize=2');
    assert.equal(secondPage.body.data.total, 3);
    assert.deepEqual(
        secondPage.body.data.items.map((lobby) => lobby.title),
        ['first']
    );

    const wingman = await request('GET', '/api/v1/lobbies?mode=wingman');
    assert.equal(wingman.body.data.total, 1);
    assert.equal(wingman.body.data.items[0].title, 'third');

    const badQueries = [
        'page=0',
        'page=1.5',
        'pageSize=51',
        'pageSize=abc',
        'mode=deathmatch',
        'page=1&page=2',
    ];
    for (const query of badQueries) {
        const result = await request('GET', `/api/v1/lobbies?${query}`);
        assert.equal(result.status, 400, query);
        assert.equal(result.body.code, 40000, query);
    }

    const badToken = await request('GET', '/api/v1/lobbies', { token: 'not-a-real-token' });
    assert.equal(badToken.status, 401);
    assert.equal(badToken.body.code, 40002);
});

test('the code is hidden from the public and visible to the owner', async () => {
    const alice = await register('alice');
    const created = await createLobby(alice.access_token);
    const id = created.body.data.id;

    const anonymous = await request('GET', `/api/v1/lobbies/${id}`);
    assert.equal(anonymous.status, 200);
    assert.equal(anonymous.body.data.team_code, null);
    assert.equal(anonymous.body.data.is_owner, false);
    assert.equal(anonymous.body.data.is_claimed, false);
    assert.equal(anonymous.body.data.can_claim, true);
    assert.equal(anonymous.body.data.current_players, 4);
    assert.equal(anonymous.body.data.slots_needed, 1);

    const owner = await request('GET', `/api/v1/lobbies/${id}`, {
        token: alice.access_token,
    });
    assert.equal(owner.body.data.team_code, TEAM_CODE);
    assert.equal(owner.body.data.is_owner, true);
    assert.equal(owner.body.data.can_claim, false);

    const ownerList = await request('GET', '/api/v1/lobbies', { token: alice.access_token });
    assert.equal(ownerList.body.data.items[0].team_code, TEAM_CODE);

    const badToken = await request('GET', `/api/v1/lobbies/${id}`, {
        token: 'not-a-real-token',
    });
    assert.equal(badToken.status, 401);
    assert.equal(badToken.body.code, 40002);

    const missing = await request('GET', '/api/v1/lobbies/9999');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 40400);

    const malformed = await request('GET', '/api/v1/lobbies/not-a-number');
    assert.equal(malformed.status, 404);
});

// --------------------------------------------------------------------------- //
// claim / virtual player
// --------------------------------------------------------------------------- //

test('claiming reveals the code and adds a virtual player without filling the team', async () => {
    const alice = await register('alice');
    const bob = await register('bob', 'Bob');
    const carol = await register('carol', 'Carol');
    const created = await createLobby(alice.access_token);
    const id = created.body.data.id;

    const claimed = await claim(bob.access_token, id);
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    assert.equal(claimed.body.data.team_code, TEAM_CODE);
    assert.equal(claimed.body.data.lobby_id, id);
    assert.ok(claimed.body.data.claimed_at);

    const lobby = claimed.body.data.lobby;
    assert.equal(lobby.team_code, TEAM_CODE);
    assert.equal(lobby.current_players, 4);
    assert.equal(lobby.slots_needed, 1);
    assert.equal(lobby.claim_count, 1);
    assert.equal(lobby.is_claimed, true);
    assert.equal(lobby.is_owner, false);
    assert.equal(lobby.can_claim, false);
    assert.equal(lobby.claimants.length, 1);
    assert.equal(lobby.claimants[0].user_id, bob.user.id);
    assert.equal(lobby.claimants[0].username, 'bob');
    assert.equal(lobby.claimants[0].nickname, 'Bob');
    assert.equal(lobby.claimants[0].is_you, true);

    // The team is still short-handed and still listed.
    const hall = await request('GET', '/api/v1/lobbies');
    assert.equal(hall.body.data.total, 1);
    assert.equal(hall.body.data.items[0].current_players, 4);
    assert.equal(hall.body.data.items[0].slots_needed, 1);
    assert.equal(hall.body.data.items[0].claim_count, 1);
    assert.equal(hall.body.data.items[0].team_code, null);
    assert.equal(hall.body.data.items[0].claimants[0].username, 'bob');

    const asBob = await request('GET', `/api/v1/lobbies/${id}`, {
        token: bob.access_token,
    });
    assert.equal(asBob.body.data.team_code, TEAM_CODE);
    assert.equal(asBob.body.data.is_claimed, true);

    const asBobList = await request('GET', '/api/v1/lobbies', {
        token: bob.access_token,
    });
    assert.equal(asBobList.body.data.items[0].team_code, TEAM_CODE);
    assert.equal(asBobList.body.data.items[0].claimants[0].is_you, true);

    const again = await claim(bob.access_token, id);
    assert.equal(again.status, 200);
    assert.equal(again.body.data.claimed_at, claimed.body.data.claimed_at);
    assert.equal(again.body.data.lobby.claim_count, 1);

    // A second stranger may also claim the same code; multiple virtual players
    // still do not fill the declared 4/5 roster.
    const byCarol = await claim(carol.access_token, id);
    assert.equal(byCarol.status, 200);
    assert.equal(byCarol.body.data.lobby.claim_count, 2);
    assert.equal(byCarol.body.data.lobby.current_players, 4);
    assert.equal(byCarol.body.data.lobby.slots_needed, 1);
    assert.equal(byCarol.body.data.lobby.claimants.length, 2);
    assert.deepEqual(
        byCarol.body.data.lobby.claimants.map((claimant) => claimant.username),
        ['bob', 'carol']
    );

    const ownerClaim = await claim(alice.access_token, id);
    assert.equal(ownerClaim.status, 403);
    assert.equal(ownerClaim.body.code, 40300);

    const noToken = await claim(undefined, id);
    assert.equal(noToken.status, 401);

    const missing = await claim(bob.access_token, 9999);
    assert.equal(missing.status, 404);
});

test('a player can cancel a claim and the code becomes hidden again', async () => {
    const alice = await register('alice');
    const bob = await register('bob');
    const created = await createLobby(alice.access_token);
    const id = created.body.data.id;
    await claim(bob.access_token, id);

    const cancelled = await cancel(bob.access_token, id);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.data.claim_count, 0);
    assert.equal(cancelled.body.data.is_claimed, false);
    assert.equal(cancelled.body.data.team_code, null);
    assert.deepEqual(cancelled.body.data.claimants, []);

    const detail = await request('GET', `/api/v1/lobbies/${id}`, {
        token: bob.access_token,
    });
    assert.equal(detail.body.data.team_code, null);
    assert.equal(detail.body.data.is_claimed, false);

    const hall = await request('GET', '/api/v1/lobbies');
    assert.equal(hall.body.data.total, 1);
    assert.equal(hall.body.data.items[0].current_players, 4);

    const again = await cancel(bob.access_token, id);
    assert.equal(again.status, 404);
    assert.equal(again.body.code, 40400);
});

test('join/leave are compatibility aliases for claim/cancel', async () => {
    const alice = await register('alice');
    const bob = await register('bob');
    const created = await createLobby(alice.access_token);
    const id = created.body.data.id;

    const joined = await request('POST', `/api/v1/lobbies/${id}/join`, {
        token: bob.access_token,
    });
    assert.equal(joined.status, 200);
    assert.equal(joined.body.data.team_code, TEAM_CODE);
    assert.equal(joined.body.data.lobby.claim_count, 1);

    const left = await request('DELETE', `/api/v1/lobbies/${id}/leave`, {
        token: bob.access_token,
    });
    assert.equal(left.status, 200);
    assert.equal(left.body.data.claim_count, 0);
});

// --------------------------------------------------------------------------- //
// depart / kick
// --------------------------------------------------------------------------- //

test('the owner can depart, hiding the post and stopping new claims', async () => {
    const alice = await register('alice');
    const bob = await register('bob');
    const created = await createLobby(alice.access_token);
    const id = created.body.data.id;
    await claim(bob.access_token, id);

    const forbidden = await request('POST', `/api/v1/lobbies/${id}/depart`, {
        token: bob.access_token,
    });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.code, 40300);

    const noToken = await request('POST', `/api/v1/lobbies/${id}/depart`);
    assert.equal(noToken.status, 401);

    const departed = await request('POST', `/api/v1/lobbies/${id}/depart`, {
        token: alice.access_token,
    });
    assert.equal(departed.status, 200, JSON.stringify(departed.body));
    assert.equal(departed.body.data.status, 'departed');
    assert.ok(departed.body.data.departed_at);
    assert.equal(departed.body.data.team_code, TEAM_CODE);
    assert.equal(departed.body.data.claim_count, 1);

    const hall = await request('GET', '/api/v1/lobbies');
    assert.equal(hall.body.data.total, 0);

    const publicDetail = await request('GET', `/api/v1/lobbies/${id}`);
    assert.equal(publicDetail.status, 404);
    assert.equal(publicDetail.body.code, 40400);

    // Even a user who already claimed the code loses access to the post.
    const claimedDetail = await request('GET', `/api/v1/lobbies/${id}`, {
        token: bob.access_token,
    });
    assert.equal(claimedDetail.status, 404);

    const lateClaim = await claim(bob.access_token, id);
    assert.equal(lateClaim.status, 404);
    assert.equal(lateClaim.body.code, 40400);

    const ownerDetail = await request('GET', `/api/v1/lobbies/${id}`, {
        token: alice.access_token,
    });
    assert.equal(ownerDetail.status, 200);
    assert.equal(ownerDetail.body.data.status, 'departed');
    assert.equal(ownerDetail.body.data.team_code, TEAM_CODE);

    const again = await request('POST', `/api/v1/lobbies/${id}/depart`, {
        token: alice.access_token,
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.data.status, 'departed');

    const deleted = await request('DELETE', `/api/v1/lobbies/${id}`, {
        token: alice.access_token,
    });
    assert.equal(deleted.status, 200);
});

test('the owner can kick a virtual claimant and block re-claiming', async () => {
    const alice = await register('alice');
    const bob = await register('bob');
    const carol = await register('carol');
    const created = await createLobby(alice.access_token);
    const id = created.body.data.id;
    await claim(bob.access_token, id);
    await claim(carol.access_token, id);

    const forbidden = await request(
        'DELETE',
        `/api/v1/lobbies/${id}/claimants/${carol.user.id}`,
        { token: bob.access_token }
    );
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.code, 40300);

    const kicked = await request(
        'DELETE',
        `/api/v1/lobbies/${id}/claimants/${carol.user.id}`,
        { token: alice.access_token }
    );
    assert.equal(kicked.status, 200, JSON.stringify(kicked.body));
    assert.equal(kicked.body.data.claim_count, 1);
    assert.deepEqual(
        kicked.body.data.claimants.map((claimant) => claimant.username),
        ['bob']
    );

    const claimRow = db
        .prepare('SELECT * FROM lobby_claims WHERE lobby_id = ? AND user_id = ?')
        .get(id, carol.user.id);
    assert.equal(claimRow.status, 'kicked');
    assert.ok(claimRow.kicked_at);

    const asCarol = await request('GET', `/api/v1/lobbies/${id}`, {
        token: carol.access_token,
    });
    assert.equal(asCarol.status, 200);
    assert.equal(asCarol.body.data.is_claimed, false);
    assert.equal(asCarol.body.data.team_code, null);
    assert.equal(asCarol.body.data.claim_count, 1);

    const reclaim = await claim(carol.access_token, id);
    assert.equal(reclaim.status, 403);
    assert.equal(reclaim.body.code, 40300);
    assert.match(reclaim.body.message, /removed/i);

    const again = await request(
        'DELETE',
        `/api/v1/lobbies/${id}/claimants/${carol.user.id}`,
        { token: alice.access_token }
    );
    assert.equal(again.status, 404);

    const unknown = await request('DELETE', `/api/v1/lobbies/${id}/claimants/9999`, {
        token: alice.access_token,
    });
    assert.equal(unknown.status, 404);
});

// --------------------------------------------------------------------------- //
// deletion / expiry / full teams
// --------------------------------------------------------------------------- //

test('only the owner can delete a lobby', async () => {
    const alice = await register('alice');
    const bob = await register('bob');
    const created = await createLobby(alice.access_token);
    const id = created.body.data.id;
    await claim(bob.access_token, id);

    const forbidden = await request('DELETE', `/api/v1/lobbies/${id}`, {
        token: bob.access_token,
    });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.code, 40300);

    const deleted = await request('DELETE', `/api/v1/lobbies/${id}`, {
        token: alice.access_token,
    });
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body.data, { id });

    assert.equal((await request('GET', `/api/v1/lobbies/${id}`)).status, 404);
    assert.equal(
        db.prepare('SELECT COUNT(*) AS total FROM lobby_claims WHERE lobby_id = ?').get(id).total,
        0
    );
    assert.equal((await request('GET', '/api/v1/lobbies')).body.data.total, 0);
});

test('the hall only lists short-handed teams', async () => {
    const alice = await register('alice');
    const bob = await register('bob');
    const created = await createLobby(alice.access_token);
    const id = created.body.data.id;

    // Simulate the owner filling the roster offline; the API prevents creating
    // an already-full team, but the hall still must not show one.
    db.prepare('UPDATE lobbies SET current_players = team_size WHERE id = ?').run(id);

    const hall = await request('GET', '/api/v1/lobbies');
    assert.equal(hall.body.data.total, 0);

    const detail = await request('GET', `/api/v1/lobbies/${id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.slots_needed, 0);
    assert.equal(detail.body.data.can_claim, false);

    const claimed = await claim(bob.access_token, id);
    assert.equal(claimed.status, 409);
    assert.equal(claimed.body.code, 40900);
});

test('expired posts are removed from the hall and cannot be claimed', async () => {
    const alice = await register('alice');
    const bob = await register('bob');
    const created = await createLobby(alice.access_token);
    const id = created.body.data.id;

    db.prepare('UPDATE lobbies SET expires_at = ? WHERE id = ?').run(
        '2020-01-01T00:00:00.000Z',
        id
    );

    const hall = await request('GET', '/api/v1/lobbies');
    assert.equal(hall.body.data.total, 0);
    assert.equal(
        db.prepare('SELECT COUNT(*) AS total FROM lobbies WHERE id = ?').get(id).total,
        0
    );
    assert.equal((await request('GET', `/api/v1/lobbies/${id}`)).status, 404);

    const second = await createLobby(alice.access_token, { title: 'expires before claim' });
    const secondId = second.body.data.id;
    db.prepare('UPDATE lobbies SET expires_at = ? WHERE id = ?').run(
        '2020-01-01T00:00:00.000Z',
        secondId
    );
    const expiredClaim = await claim(bob.access_token, secondId);
    assert.equal(expiredClaim.status, 404);
    assert.equal(expiredClaim.body.code, 40400);
});
