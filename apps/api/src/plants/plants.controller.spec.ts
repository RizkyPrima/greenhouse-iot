import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PlantsController } from './plants.controller.js';
import { PlatformAdminGuard } from './platform-admin.guard.js';

describe('PlantsController platform grants', () => {
  it('protects the catalog grant list with PlatformAdminGuard', async () => {
    const listPlatformGrants = vi.fn().mockResolvedValue([]);
    const controller = new PlantsController({ listPlatformGrants } as never, {} as never, {} as never, {} as never, {} as never, {} as never);

    await expect(controller.listPlatformGrants()).resolves.toEqual([]);
    expect(listPlatformGrants).toHaveBeenCalledOnce();
    const handler = Object.getOwnPropertyDescriptor(PlantsController.prototype, 'listPlatformGrants')?.value;
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(PlatformAdminGuard);
  });
});
