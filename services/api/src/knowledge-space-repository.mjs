import { inTransaction, iso } from './knowledge-repository-utils.mjs';

function normalizeSpace(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    purposeLabel: row.purpose_label,
    role: row.role,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

export class PostgresKnowledgeSpaceRepository {
  constructor(pool) { this.pool = pool; }

  async classroomRole(userId) {
    const result = await this.pool.query(
      'SELECT classroom_role FROM users WHERE id = $1',
      [userId],
    );
    return result.rows[0]?.classroom_role ?? null;
  }

  async create({ clientId, description, name, ownerUserId, purposeLabel }) {
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`space:${ownerUserId}:${clientId}`]);
      const existing = await client.query(
        `SELECT spaces.*, members.role FROM knowledge_spaces spaces
         JOIN knowledge_space_members members ON members.space_id = spaces.id AND members.user_id = $1
         WHERE spaces.owner_user_id = $1 AND spaces.client_id = $2`, [ownerUserId, clientId],
      );
      if (existing.rows[0]) return { newlyCreated: false, space: normalizeSpace(existing.rows[0]) };
      const inserted = await client.query(
        `INSERT INTO knowledge_spaces (client_id, owner_user_id, name, description, purpose_label)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`, [clientId, ownerUserId, name, description, purposeLabel],
      );
      await client.query(
        `INSERT INTO knowledge_space_members (space_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [inserted.rows[0].id, ownerUserId],
      );
      return { newlyCreated: true, space: normalizeSpace({ ...inserted.rows[0], role: 'owner' }) };
    });
  }

  async listForUser(userId, { cursor = null, limit = 50 } = {}) {
    const values = [userId];
    let cursorSql = '';
    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      cursorSql = `AND (spaces.created_at, spaces.id) < ($2::timestamptz, $3::uuid)`;
    }
    values.push(limit + 1);
    const result = await this.pool.query(
      `SELECT spaces.*, members.role, users.classroom_role FROM knowledge_spaces spaces
       JOIN knowledge_space_members members ON members.space_id = spaces.id
       JOIN users ON users.id = members.user_id
       WHERE members.user_id = $1 AND members.removed_at IS NULL AND spaces.archived_at IS NULL
       ${cursorSql}
       ORDER BY spaces.created_at DESC, spaces.id DESC LIMIT $${values.length}`,
      values,
    );
    const rows = result.rows.slice(0, limit);
    return {
      classroomRole: result.rows[0]?.classroom_role
        ?? await this.classroomRole(userId)
        ?? 'unassigned',
      items: rows.map(normalizeSpace),
      nextCursor: result.rows.length > limit && rows.length
        ? { createdAt: iso(rows.at(-1).created_at), id: rows.at(-1).id }
        : null,
    };
  }

  async membership(spaceId, userId) {
    const result = await this.pool.query(
      `SELECT role FROM knowledge_space_members
       WHERE space_id = $1 AND user_id = $2 AND removed_at IS NULL`, [spaceId, userId],
    );
    return result.rows[0]?.role ?? null;
  }

  async membershipContext(spaceId, userId) {
    const result = await this.pool.query(
      `SELECT members.role AS space_role, users.classroom_role
       FROM knowledge_space_members members
       JOIN users ON users.id = members.user_id
       WHERE members.space_id = $1
         AND members.user_id = $2
         AND members.removed_at IS NULL`,
      [spaceId, userId],
    );
    const row = result.rows[0];
    return row
      ? { classroomRole: row.classroom_role, spaceRole: row.space_role }
      : null;
  }

  async countOwned(userId) {
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS value FROM knowledge_spaces
       WHERE owner_user_id=$1 AND archived_at IS NULL`,
      [userId],
    );
    return result.rows[0]?.value ?? 0;
  }

  async get(spaceId, userId) {
    const result = await this.pool.query(
      `SELECT spaces.*, members.role FROM knowledge_spaces spaces
       JOIN knowledge_space_members members ON members.space_id = spaces.id
       WHERE spaces.id = $1 AND members.user_id = $2 AND members.removed_at IS NULL`, [spaceId, userId],
    );
    return normalizeSpace(result.rows[0]);
  }

  async createGroup({ clientId, name, spaceId, userId }) {
    const result = await this.pool.query(
      `INSERT INTO knowledge_space_groups (client_id, space_id, name, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (space_id, client_id) DO UPDATE SET name = knowledge_space_groups.name
       RETURNING id, name, created_at`, [clientId, spaceId, name, userId],
    );
    const row = result.rows[0];
    return { id: row.id, name: row.name, createdAt: iso(row.created_at) };
  }

  async listGroups(spaceId) {
    const result = await this.pool.query(
      `SELECT groups.id,groups.name,groups.created_at,
              COUNT(members.user_id)::int AS participant_count
       FROM knowledge_space_groups groups
       LEFT JOIN knowledge_space_group_members members ON members.group_id=groups.id
       WHERE groups.space_id=$1 AND groups.archived_at IS NULL
       GROUP BY groups.id
       ORDER BY groups.created_at DESC,groups.id DESC
       LIMIT 500`,
      [spaceId],
    );
    return result.rows.map((row) => ({
      createdAt: iso(row.created_at),
      id: row.id,
      name: row.name?.trim() || row.user_id,
      participantCount: row.participant_count,
    }));
  }

  async listMembers(spaceId) {
    const result = await this.pool.query(
      `SELECT members.user_id,members.role,members.joined_at,
              users.email,users.name,users.classroom_role
       FROM knowledge_space_members members
       JOIN users ON users.id=members.user_id
       WHERE members.space_id=$1 AND members.removed_at IS NULL
       ORDER BY members.joined_at,members.user_id LIMIT 2000`,
      [spaceId],
    );
    return result.rows.map((row) => ({
      classroomRole: row.classroom_role,
      email: row.email,
      joinedAt: iso(row.joined_at),
      name: row.name,
      role: row.role,
      userId: row.user_id,
    }));
  }

  async addMembers({ clientId, emails, role, spaceId, userId }) {
    return inTransaction(this.pool, async (client) => {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`members:${spaceId}`],
      );
      const existingBatch = await client.query(
        `SELECT result FROM knowledge_space_member_batches
         WHERE space_id=$1 AND client_id=$2`,
        [spaceId, clientId],
      );
      if (existingBatch.rows[0]) return parseJson(existingBatch.rows[0].result);

      const normalizedEmails = [...new Set(emails.map((email) => email.trim().toLowerCase()))];
      const users = await client.query(
        `SELECT id,email,classroom_role,blocked_at
         FROM users
         WHERE LOWER(email)=ANY($1::text[])
         FOR UPDATE`,
        [normalizedEmails],
      );
      const usersByEmail = new Map();
      for (const row of users.rows) {
        const email = row.email.toLowerCase();
        const candidates = usersByEmail.get(email) ?? [];
        candidates.push(row);
        usersByEmail.set(email, candidates);
      }
      const expectedClassroomRole = role === 'facilitator' ? 'teacher' : 'student';
      const unavailableEmails = [];
      const roleMismatchEmails = [];
      const eligibleUsers = [];
      for (const email of normalizedEmails) {
        const candidates = usersByEmail.get(email) ?? [];
        const candidate = candidates[0];
        if (candidates.length !== 1 || candidate.blocked_at) {
          unavailableEmails.push(email);
        } else if (candidate.classroom_role !== expectedClassroomRole) {
          roleMismatchEmails.push(email);
        } else {
          eligibleUsers.push(candidate);
        }
      }

      const existingMembers = await client.query(
        `SELECT user_id FROM knowledge_space_members
         WHERE space_id=$1 AND user_id=ANY($2::text[]) AND removed_at IS NULL`,
        [spaceId, eligibleUsers.map((user) => user.id)],
      );
      const existingUserIds = new Set(existingMembers.rows.map((row) => row.user_id));
      const alreadyMemberEmails = eligibleUsers
        .filter((user) => existingUserIds.has(user.id))
        .map((user) => user.email.toLowerCase());
      const usersToAdd = eligibleUsers.filter((user) => !existingUserIds.has(user.id));
      if (usersToAdd.length) {
        await client.query(
          `INSERT INTO knowledge_space_members (space_id,user_id,role)
           SELECT $1,users.id,$2
           FROM users
           WHERE users.id=ANY($3::text[])
           ON CONFLICT (space_id,user_id) DO UPDATE
             SET role=EXCLUDED.role,removed_at=NULL,joined_at=NOW()`,
          [spaceId, role, usersToAdd.map((user) => user.id)],
        );
      }
      const result = {
        addedEmails: usersToAdd.map((user) => user.email.toLowerCase()),
        alreadyMemberEmails,
        requestedRole: role,
        roleMismatchEmails,
        spaceId,
        unavailableEmails,
      };
      await client.query(
        `INSERT INTO knowledge_space_member_batches
           (client_id,space_id,requested_role,created_by,result)
         VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [clientId, spaceId, role, userId, JSON.stringify(result)],
      );
      return result;
    });
  }

  async createInvite({ clientId, codeDigest, expiresAt, groupId, maxUses, role, spaceId, userId }) {
    const result = await this.pool.query(
      `INSERT INTO knowledge_space_invites
         (client_id, space_id, group_id, code_digest, role, max_uses, expires_at, created_by)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8
       WHERE $3::uuid IS NULL OR EXISTS (
         SELECT 1 FROM knowledge_space_groups
         WHERE id=$3 AND space_id=$2 AND archived_at IS NULL
       )
       ON CONFLICT (space_id, client_id) DO UPDATE SET client_id = EXCLUDED.client_id
       RETURNING id, role, max_uses, expires_at, created_at`,
      [clientId, spaceId, groupId, codeDigest, role, maxUses, expiresAt, userId],
    );
    const row = result.rows[0];
    if (!row) {
      const error = new Error('Group not found in this Space.');
      error.status = 404; error.code = 'group_not_found'; throw error;
    }
    return { id: row.id, role: row.role, maxUses: row.max_uses, expiresAt: iso(row.expires_at), createdAt: iso(row.created_at) };
  }

  async redeemInvite({ codeDigest, userId }) {
    return inTransaction(this.pool, async (client) => {
      const invite = await client.query(
        `SELECT * FROM knowledge_space_invites WHERE code_digest = $1 FOR UPDATE`, [codeDigest],
      );
      const row = invite.rows[0];
      if (!row) return null;
      const userResult = await client.query(
        `SELECT classroom_role,blocked_at FROM users WHERE id=$1 FOR UPDATE`,
        [userId],
      );
      const user = userResult.rows[0];
      const expectedClassroomRole = row.role === 'facilitator' ? 'teacher' : 'student';
      if (!user || user.blocked_at || user.classroom_role !== expectedClassroomRole) {
        return { kind: 'role_mismatch' };
      }
      const redemption = await client.query(
        `SELECT 1 FROM knowledge_space_invite_redemptions
         WHERE invite_id=$1 AND user_id=$2`,
        [row.id, userId],
      );
      const existing = await client.query(
        `SELECT role FROM knowledge_space_members WHERE space_id = $1 AND user_id = $2 AND removed_at IS NULL`, [row.space_id, userId],
      );
      if (redemption.rows[0]) return { spaceId: row.space_id, role: existing.rows[0]?.role ?? row.role };
      if (row.revoked_at || (row.expires_at && row.expires_at <= new Date()) || row.used_count >= row.max_uses) return null;
      if (!existing.rows[0]) {
        await client.query(
          `INSERT INTO knowledge_space_members (space_id, user_id, role) VALUES ($1,$2,$3)
           ON CONFLICT (space_id,user_id) DO UPDATE
             SET role=EXCLUDED.role,removed_at=NULL,joined_at=NOW()`, [row.space_id, userId, row.role],
        );
      }
      if (row.group_id) await client.query(
        `INSERT INTO knowledge_space_group_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [row.group_id, userId],
      );
      await client.query(`UPDATE knowledge_space_invites SET used_count = used_count + 1 WHERE id = $1`, [row.id]);
      await client.query(
        `INSERT INTO knowledge_space_invite_redemptions (invite_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [row.id, userId],
      );
      return { spaceId: row.space_id, role: existing.rows[0]?.role ?? row.role };
    });
  }
}
