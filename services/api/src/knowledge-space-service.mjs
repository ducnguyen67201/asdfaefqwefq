import { createHmac, randomBytes } from 'node:crypto';
import {
  assertClassroomRoleForSpaceRole,
  assertSpaceRole,
} from './knowledge-space-policy.mjs';

function inviteDigest(code, hmacKey) { return createHmac('sha256', hmacKey).update(code.trim().toUpperCase()).digest(); }
function inviteCode() { return `TROSPACE-${randomBytes(12).toString('base64url').toUpperCase()}`; }

export class KnowledgeSpaceService {
  constructor({ hmacKey, sourceRepository, spaceRepository, uploadService }) {
    this.hmacKey = hmacKey; this.sourceRepository = sourceRepository; this.spaceRepository = spaceRepository; this.uploadService = uploadService;
  }
  async create(userId, input, limits = null) {
    const classroomRole = await this.spaceRepository.classroomRole(userId);
    if (classroomRole !== 'teacher') {
      const error = new Error('An administrator must assign the Teacher role before you can create a class.');
      error.status = 403; error.code = 'teacher_role_required'; throw error;
    }
    if (limits && await this.spaceRepository.countOwned(userId) >= limits.spaceCount) {
      const error = new Error('This plan reached its Knowledge Space limit.');
      error.status = 409; error.code = 'space_quota_reached'; throw error;
    }
    return this.spaceRepository.create({ ...input, ownerUserId: userId });
  }
  list(userId) { return this.spaceRepository.listForUser(userId); }
  async get(userId, spaceId) {
    await this.role(userId, spaceId, 'space.read');
    return this.spaceRepository.get(spaceId, userId);
  }

  async role(userId, spaceId, operation) {
    const membership = await this.spaceRepository.membershipContext(spaceId, userId);
    if (!membership) { const error = new Error('Space not found.'); error.status = 404; error.code = 'space_not_found'; throw error; }
    assertClassroomRoleForSpaceRole(membership.classroomRole, membership.spaceRole);
    assertSpaceRole(membership.spaceRole, operation); return membership.spaceRole;
  }
  async listSources(userId, spaceId) {
    const role = await this.role(userId, spaceId, 'space.read');
    assertSpaceRole(role, role === 'participant' ? 'source.read_pinned' : 'source.read');
    return this.sourceRepository.list(spaceId, userId);
  }
  async initiateUpload(userId, spaceId, input, limits = null) {
    await this.role(userId, spaceId, 'source.upload');
    if (limits) {
      if (input.files.length > limits.uploadFilesPerBatch) {
        const error = new Error('This upload has too many files for the current plan.');
        error.status = 409; error.code = 'upload_file_quota'; throw error;
      }
      const used = await this.sourceRepository.storageUsedByOwner(userId);
      const requested = input.files.reduce((total, file) => total + file.byteSize, 0);
      if (used + requested > limits.spaceStorageBytes) {
        const error = new Error('This plan reached its Knowledge Space storage limit.');
        error.status = 409; error.code = 'storage_quota_reached'; throw error;
      }
    }
    return this.uploadService.initiate({ ...input, spaceId, userId });
  }
  completeUpload(userId, input) {
    return this.uploadService.complete({ sourceVersionId: input.sourceVersionId, userId });
  }
  async createGroup(userId, spaceId, input) { await this.role(userId, spaceId, 'group.manage'); return this.spaceRepository.createGroup({ ...input, spaceId, userId }); }
  async listGroups(userId, spaceId) { await this.role(userId, spaceId, 'group.manage'); return this.spaceRepository.listGroups(spaceId); }
  async listMembers(userId, spaceId) { await this.role(userId, spaceId, 'member.read'); return this.spaceRepository.listMembers(spaceId); }
  async addMembers(userId, spaceId, input) {
    const actorRole = await this.role(
      userId,
      spaceId,
      input.role === 'facilitator' ? 'member.manage' : 'invite.participant',
    );
    if (actorRole === 'facilitator' && input.role !== 'participant') {
      const error = new Error('Teachers can only add students to a class they do not own.');
      error.status = 403; error.code = 'space_forbidden'; throw error;
    }
    return this.spaceRepository.addMembers({ ...input, spaceId, userId });
  }
  async createInvite(userId, spaceId, input) {
    await this.role(
      userId,
      spaceId,
      input.role === 'facilitator' ? 'member.manage' : 'invite.participant',
    );
    const code = inviteCode();
    const invite = await this.spaceRepository.createInvite({ ...input, codeDigest: inviteDigest(code, this.hmacKey), spaceId, userId });
    return { ...invite, code };
  }
  async redeemInvite(userId, code) {
    const result = await this.spaceRepository.redeemInvite({ codeDigest: inviteDigest(code, this.hmacKey), userId });
    if (result?.kind === 'role_mismatch') {
      const error = new Error('This invite does not match the role assigned to your account.');
      error.status = 403; error.code = 'classroom_role_mismatch'; throw error;
    }
    return result;
  }
}
