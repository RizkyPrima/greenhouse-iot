import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PlantsService } from './plants.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

const actor = { id: 'platform-1', isActive: true } as AuthenticatedUser;
const draftVersion = {
  id: 'catalog-version-1',
  status: 'DRAFT',
  profileDefaults: {},
  stageTemplates: [],
};
const definition = {
  id: 'parameter-1',
  plantCatalogVersionId: draftVersion.id,
  parameterKey: 'temperature',
  label: 'Temperature',
  dataType: 'number',
  unit: 'C',
  valueSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'number', minimum: 0, maximum: 50 },
  metadataSchema: {},
  plantCatalogVersion: draftVersion,
};

function makeService(overrides: Record<string, unknown> = {}) {
  const tx = {
    plantParameterDefinition: {
      findFirst: vi.fn().mockResolvedValue(definition),
      findMany: vi.fn().mockResolvedValue([definition]),
      update: vi.fn().mockResolvedValue({ ...definition, label: 'Air temperature' }),
      delete: vi.fn().mockResolvedValue(definition),
      ...((overrides.plantParameterDefinition ?? {}) as object),
    },
    plantConfigAuditEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = { $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) };
  return { service: new PlantsService(prisma as never, {} as never), tx };
}

describe('Plant parameter definition draft workflow', () => {
  it('allows editing a parameter on a draft catalog version and writes an audit event', async () => {
    const { service, tx } = makeService();

    await expect(service.updateParameterDefinition(draftVersion.id, definition.id, { label: 'Air temperature' }, actor))
      .resolves.toMatchObject({ label: 'Air temperature' });

    expect(tx.plantParameterDefinition.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: definition.id },
      data: expect.objectContaining({ label: 'Air temperature', parameterKey: 'temperature' }),
    }));
    expect(tx.plantConfigAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'PARAMETER_DEFINITION_EDITED', entityId: definition.id }),
    }));
  });

  it('allows deleting an unused parameter from a draft and audits the deletion', async () => {
    const { service, tx } = makeService({ plantParameterDefinition: { findMany: vi.fn().mockResolvedValue([]) } });

    await expect(service.deleteParameterDefinition(draftVersion.id, definition.id, actor))
      .resolves.toEqual({ id: definition.id, deleted: true });
    expect(tx.plantParameterDefinition.delete).toHaveBeenCalledWith({ where: { id: definition.id } });
    expect(tx.plantConfigAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'PARAMETER_DEFINITION_DELETED', entityId: definition.id }),
    }));
  });

  it('rejects edit and deletion for published catalog versions', async () => {
    const published = { ...definition, plantCatalogVersion: { ...draftVersion, status: 'PUBLISHED' } };
    const { service, tx } = makeService({ plantParameterDefinition: { findFirst: vi.fn().mockResolvedValue(published) } });

    await expect(service.updateParameterDefinition(draftVersion.id, definition.id, { label: 'Changed' }, actor))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(service.deleteParameterDefinition(draftVersion.id, definition.id, actor))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.plantParameterDefinition.update).not.toHaveBeenCalled();
    expect(tx.plantParameterDefinition.delete).not.toHaveBeenCalled();
  });

  it('returns not found when the parameter does not belong to the requested version', async () => {
    const { service } = makeService({ plantParameterDefinition: { findFirst: vi.fn().mockResolvedValue(null) } });

    await expect(service.updateParameterDefinition(draftVersion.id, 'missing', { label: 'Changed' }, actor))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deleteParameterDefinition(draftVersion.id, 'missing', actor))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects invalid keys, schemas, and impossible bounds', async () => {
    const { service, tx } = makeService();

    await expect(service.updateParameterDefinition(draftVersion.id, definition.id, { parameterKey: 'Bad-Key' }, actor))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.updateParameterDefinition(draftVersion.id, definition.id, {
      valueSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'number', minimum: 20, maximum: 10 },
    }, actor)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx.plantParameterDefinition.update).not.toHaveBeenCalled();
  });

  it('blocks deleting a parameter referenced by catalog defaults or stage templates', async () => {
    const inUse = { ...definition, plantCatalogVersion: { ...draftVersion, profileDefaults: { temperature: 22 } } };
    const { service, tx } = makeService({ plantParameterDefinition: { findFirst: vi.fn().mockResolvedValue(inUse) } });

    await expect(service.deleteParameterDefinition(draftVersion.id, definition.id, actor))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.plantParameterDefinition.delete).not.toHaveBeenCalled();
  });

  it('blocks renaming a parameter that is referenced by a catalog default', async () => {
    const inUse = { ...definition, plantCatalogVersion: { ...draftVersion, profileDefaults: { temperature: 22 } } };
    const { service, tx } = makeService({ plantParameterDefinition: { findFirst: vi.fn().mockResolvedValue(inUse) } });

    await expect(service.updateParameterDefinition(draftVersion.id, definition.id, { parameterKey: 'airTemperature' }, actor))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.plantParameterDefinition.update).not.toHaveBeenCalled();
  });
});
