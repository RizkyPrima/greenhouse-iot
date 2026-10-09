const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

const dtos = {
  organizations: {
    create: `import { IsString, IsOptional, MaxLength, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'My Organization' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'my-org' })
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(100)
  slug: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
`,
    update: `import { PartialType } from '@nestjs/swagger';
import { CreateOrganizationDto } from './create-organization.dto.js';

export class UpdateOrganizationDto extends PartialType(CreateOrganizationDto) {}
`
  },
  greenhouses: {
    create: `import { IsString, IsOptional, IsUUID, MaxLength, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GreenhouseStatus } from '@prisma/client';

export class CreateGreenhouseDto {
  @ApiProperty({ example: 'uuid' })
  @IsUUID()
  organizationId: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty()
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty()
  @IsString()
  timezone: string;

  @ApiPropertyOptional({ enum: GreenhouseStatus })
  @IsOptional()
  @IsEnum(GreenhouseStatus)
  status?: GreenhouseStatus;
}
`,
    update: `import { PartialType } from '@nestjs/swagger';
import { CreateGreenhouseDto } from './create-greenhouse.dto.js';

export class UpdateGreenhouseDto extends PartialType(CreateGreenhouseDto) {}
`
  },
  zones: {
    create: `import { IsString, IsOptional, IsUUID, MaxLength, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ZoneStatus } from '@prisma/client';

export class CreateZoneDto {
  @ApiProperty({ example: 'uuid' })
  @IsUUID()
  greenhouseId: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty()
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ZoneStatus })
  @IsOptional()
  @IsEnum(ZoneStatus)
  status?: ZoneStatus;
}
`,
    update: `import { PartialType } from '@nestjs/swagger';
import { CreateZoneDto } from './create-zone.dto.js';

export class UpdateZoneDto extends PartialType(CreateZoneDto) {}
`
  },
  devices: {
    create: `import { IsString, IsOptional, IsUUID, MaxLength, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeviceStatus } from '@prisma/client';

export class CreateDeviceDto {
  @ApiProperty()
  @IsUUID()
  greenhouseId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(50)
  deviceId: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty()
  @IsString()
  @MaxLength(50)
  deviceType: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  firmwareVersion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hardwareVersion?: string;

  @ApiPropertyOptional({ enum: DeviceStatus })
  @IsOptional()
  @IsEnum(DeviceStatus)
  status?: DeviceStatus;
}
`,
    update: `import { PartialType } from '@nestjs/swagger';
import { CreateDeviceDto } from './create-device.dto.js';

export class UpdateDeviceDto extends PartialType(CreateDeviceDto) {}
`
  },
  sensors: {
    create: `import { IsString, IsOptional, IsUUID, MaxLength, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSensorDto {
  @ApiProperty()
  @IsUUID()
  deviceId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty()
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiProperty()
  @IsString()
  @MaxLength(50)
  sensorType: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  metadata?: Record<string, any>;
}
`,
    update: `import { PartialType } from '@nestjs/swagger';
import { CreateSensorDto } from './create-sensor.dto.js';

export class UpdateSensorDto extends PartialType(CreateSensorDto) {}
`
  },
  actuators: {
    create: `import { IsString, IsOptional, IsUUID, MaxLength, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateActuatorDto {
  @ApiProperty()
  @IsUUID()
  deviceId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty()
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiProperty()
  @IsString()
  @MaxLength(50)
  actuatorType: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  metadata?: Record<string, any>;
}
`,
    update: `import { PartialType } from '@nestjs/swagger';
import { CreateActuatorDto } from './create-actuator.dto.js';

export class UpdateActuatorDto extends PartialType(CreateActuatorDto) {}
`
  }
};

const services = {
  organizations: `import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createOrganizationDto: CreateOrganizationDto) {
    const existing = await this.prisma.organization.findUnique({
      where: { slug: createOrganizationDto.slug },
    });
    if (existing) {
      throw new ConflictException('Organization slug already exists');
    }
    return this.prisma.organization.create({ data: createOrganizationDto });
  }

  findAll() {
    return this.prisma.organization.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async update(id: string, updateOrganizationDto: UpdateOrganizationDto) {
    await this.findOne(id);
    if (updateOrganizationDto.slug) {
      const existing = await this.prisma.organization.findFirst({
        where: { slug: updateOrganizationDto.slug, id: { not: id } },
      });
      if (existing) throw new ConflictException('Organization slug already exists');
    }
    return this.prisma.organization.update({
      where: { id },
      data: updateOrganizationDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.organization.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
`,
  greenhouses: `import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateGreenhouseDto } from './dto/create-greenhouse.dto.js';
import { UpdateGreenhouseDto } from './dto/update-greenhouse.dto.js';

@Injectable()
export class GreenhousesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createGreenhouseDto: CreateGreenhouseDto) {
    const org = await this.prisma.organization.findUnique({ where: { id: createGreenhouseDto.organizationId }});
    if (!org) throw new NotFoundException('Organization not found');

    const existing = await this.prisma.greenhouse.findUnique({
      where: { organizationId_code: { organizationId: createGreenhouseDto.organizationId, code: createGreenhouseDto.code } },
    });
    if (existing) throw new ConflictException('Greenhouse code already exists in this organization');

    return this.prisma.greenhouse.create({ data: createGreenhouseDto });
  }

  findAll() {
    return this.prisma.greenhouse.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const gh = await this.prisma.greenhouse.findFirst({ where: { id, deletedAt: null } });
    if (!gh) throw new NotFoundException('Greenhouse not found');
    return gh;
  }

  async update(id: string, updateGreenhouseDto: UpdateGreenhouseDto) {
    const gh = await this.findOne(id);
    if (updateGreenhouseDto.code) {
      const existing = await this.prisma.greenhouse.findFirst({
        where: {
          organizationId: gh.organizationId,
          code: updateGreenhouseDto.code,
          id: { not: id }
        },
      });
      if (existing) throw new ConflictException('Greenhouse code already exists');
    }
    return this.prisma.greenhouse.update({
      where: { id },
      data: updateGreenhouseDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.greenhouse.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async findZones(id: string) {
    await this.findOne(id);
    return this.prisma.zone.findMany({ where: { greenhouseId: id, deletedAt: null } });
  }
}
`,
  zones: `import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateZoneDto } from './dto/create-zone.dto.js';
import { UpdateZoneDto } from './dto/update-zone.dto.js';

@Injectable()
export class ZonesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createZoneDto: CreateZoneDto) {
    const gh = await this.prisma.greenhouse.findUnique({ where: { id: createZoneDto.greenhouseId } });
    if (!gh) throw new NotFoundException('Greenhouse not found');

    const existing = await this.prisma.zone.findUnique({
      where: { greenhouseId_code: { greenhouseId: createZoneDto.greenhouseId, code: createZoneDto.code } },
    });
    if (existing) throw new ConflictException('Zone code already exists in this greenhouse');

    return this.prisma.zone.create({ data: createZoneDto });
  }

  findAll() {
    return this.prisma.zone.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const zone = await this.prisma.zone.findFirst({ where: { id, deletedAt: null } });
    if (!zone) throw new NotFoundException('Zone not found');
    return zone;
  }

  async update(id: string, updateZoneDto: UpdateZoneDto) {
    const zone = await this.findOne(id);
    if (updateZoneDto.code) {
      const existing = await this.prisma.zone.findFirst({
        where: {
          greenhouseId: zone.greenhouseId,
          code: updateZoneDto.code,
          id: { not: id }
        },
      });
      if (existing) throw new ConflictException('Zone code already exists');
    }
    return this.prisma.zone.update({
      where: { id },
      data: updateZoneDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.zone.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
`,
  devices: `import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateDeviceDto } from './dto/create-device.dto.js';
import { UpdateDeviceDto } from './dto/update-device.dto.js';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDeviceDto: CreateDeviceDto) {
    const gh = await this.prisma.greenhouse.findUnique({ where: { id: createDeviceDto.greenhouseId } });
    if (!gh) throw new NotFoundException('Greenhouse not found');

    if (createDeviceDto.zoneId) {
      const zone = await this.prisma.zone.findFirst({
        where: { id: createDeviceDto.zoneId, greenhouseId: createDeviceDto.greenhouseId }
      });
      if (!zone) throw new ConflictException('Zone does not belong to the greenhouse or does not exist');
    }

    const existing = await this.prisma.device.findUnique({
      where: { deviceId: createDeviceDto.deviceId },
    });
    if (existing) throw new ConflictException('Device ID already exists');

    return this.prisma.device.create({ data: createDeviceDto });
  }

  findAll() {
    return this.prisma.device.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const device = await this.prisma.device.findFirst({ where: { id, deletedAt: null } });
    if (!device) throw new NotFoundException('Device not found');
    return device;
  }

  async update(id: string, updateDeviceDto: UpdateDeviceDto) {
    await this.findOne(id);
    if (updateDeviceDto.deviceId) {
      const existing = await this.prisma.device.findFirst({
        where: { deviceId: updateDeviceDto.deviceId, id: { not: id } },
      });
      if (existing) throw new ConflictException('Device ID already exists');
    }
    return this.prisma.device.update({
      where: { id },
      data: updateDeviceDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.device.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async findSensors(id: string) {
    await this.findOne(id);
    return this.prisma.sensor.findMany({ where: { deviceId: id, deletedAt: null } });
  }

  async findActuators(id: string) {
    await this.findOne(id);
    return this.prisma.actuator.findMany({ where: { deviceId: id, deletedAt: null } });
  }
}
`,
  sensors: `import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSensorDto } from './dto/create-sensor.dto.js';
import { UpdateSensorDto } from './dto/update-sensor.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class SensorsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createSensorDto: CreateSensorDto) {
    const device = await this.prisma.device.findUnique({ where: { id: createSensorDto.deviceId } });
    if (!device) throw new NotFoundException('Device not found');

    const existing = await this.prisma.sensor.findUnique({
      where: { deviceId_code: { deviceId: createSensorDto.deviceId, code: createSensorDto.code } },
    });
    if (existing) throw new ConflictException('Sensor code already exists for this device');

    const data: Prisma.SensorCreateInput = {
      ...createSensorDto,
      metadata: createSensorDto.metadata ? (createSensorDto.metadata as any) : Prisma.JsonNull,
      device: { connect: { id: createSensorDto.deviceId } },
      zone: createSensorDto.zoneId ? { connect: { id: createSensorDto.zoneId } } : undefined,
    };
    // @ts-ignore
    delete data.deviceId;
    // @ts-ignore
    delete data.zoneId;

    return this.prisma.sensor.create({ data });
  }

  findAll() {
    return this.prisma.sensor.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const sensor = await this.prisma.sensor.findFirst({ where: { id, deletedAt: null } });
    if (!sensor) throw new NotFoundException('Sensor not found');
    return sensor;
  }

  async update(id: string, updateSensorDto: UpdateSensorDto) {
    const sensor = await this.findOne(id);
    if (updateSensorDto.code) {
      const existing = await this.prisma.sensor.findFirst({
        where: { deviceId: sensor.deviceId, code: updateSensorDto.code, id: { not: id } },
      });
      if (existing) throw new ConflictException('Sensor code already exists for this device');
    }

    const data: Prisma.SensorUpdateInput = {
      ...updateSensorDto,
      metadata: updateSensorDto.metadata ? (updateSensorDto.metadata as any) : undefined,
    };
    // @ts-ignore
    delete data.deviceId;
    // @ts-ignore
    delete data.zoneId;
    if (updateSensorDto.zoneId) data.zone = { connect: { id: updateSensorDto.zoneId } };

    return this.prisma.sensor.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.sensor.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
`,
  actuators: `import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateActuatorDto } from './dto/create-actuator.dto.js';
import { UpdateActuatorDto } from './dto/update-actuator.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class ActuatorsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createActuatorDto: CreateActuatorDto) {
    const device = await this.prisma.device.findUnique({ where: { id: createActuatorDto.deviceId } });
    if (!device) throw new NotFoundException('Device not found');

    const existing = await this.prisma.actuator.findUnique({
      where: { deviceId_code: { deviceId: createActuatorDto.deviceId, code: createActuatorDto.code } },
    });
    if (existing) throw new ConflictException('Actuator code already exists for this device');

    const data: Prisma.ActuatorCreateInput = {
      ...createActuatorDto,
      metadata: createActuatorDto.metadata ? (createActuatorDto.metadata as any) : Prisma.JsonNull,
      device: { connect: { id: createActuatorDto.deviceId } },
      zone: createActuatorDto.zoneId ? { connect: { id: createActuatorDto.zoneId } } : undefined,
    };
    // @ts-ignore
    delete data.deviceId;
    // @ts-ignore
    delete data.zoneId;

    return this.prisma.actuator.create({ data });
  }

  findAll() {
    return this.prisma.actuator.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const actuator = await this.prisma.actuator.findFirst({ where: { id, deletedAt: null } });
    if (!actuator) throw new NotFoundException('Actuator not found');
    return actuator;
  }

  async update(id: string, updateActuatorDto: UpdateActuatorDto) {
    const actuator = await this.findOne(id);
    if (updateActuatorDto.code) {
      const existing = await this.prisma.actuator.findFirst({
        where: { deviceId: actuator.deviceId, code: updateActuatorDto.code, id: { not: id } },
      });
      if (existing) throw new ConflictException('Actuator code already exists for this device');
    }

    const data: Prisma.ActuatorUpdateInput = {
      ...updateActuatorDto,
      metadata: updateActuatorDto.metadata ? (updateActuatorDto.metadata as any) : undefined,
    };
    // @ts-ignore
    delete data.deviceId;
    // @ts-ignore
    delete data.zoneId;
    if (updateActuatorDto.zoneId) data.zone = { connect: { id: updateActuatorDto.zoneId } };

    return this.prisma.actuator.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.actuator.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
`
};

const controllers = {
  organizations: `import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { OrganizationsService } from './organizations.service.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  create(@Body() createOrganizationDto: CreateOrganizationDto) {
    return this.organizationsService.create(createOrganizationDto);
  }

  @Get()
  findAll() {
    return this.organizationsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.organizationsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateOrganizationDto: UpdateOrganizationDto) {
    return this.organizationsService.update(id, updateOrganizationDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.organizationsService.remove(id);
  }
}
`,
  greenhouses: `import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { GreenhousesService } from './greenhouses.service.js';
import { CreateGreenhouseDto } from './dto/create-greenhouse.dto.js';
import { UpdateGreenhouseDto } from './dto/update-greenhouse.dto.js';
import { CreateZoneDto } from '../zones/dto/create-zone.dto.js';
import { ZonesService } from '../zones/zones.service.js';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Greenhouses')
@Controller('greenhouses')
export class GreenhousesController {
  constructor(
    private readonly greenhousesService: GreenhousesService,
    private readonly zonesService: ZonesService
  ) {}

  @Post()
  create(@Body() createGreenhouseDto: CreateGreenhouseDto) {
    return this.greenhousesService.create(createGreenhouseDto);
  }

  @Get()
  findAll() {
    return this.greenhousesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.greenhousesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateGreenhouseDto: UpdateGreenhouseDto) {
    return this.greenhousesService.update(id, updateGreenhouseDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.greenhousesService.remove(id);
  }

  @Get(':id/zones')
  findZones(@Param('id') id: string) {
    return this.greenhousesService.findZones(id);
  }

  @Post(':id/zones')
  createZone(@Param('id') id: string, @Body() createZoneDto: CreateZoneDto) {
    createZoneDto.greenhouseId = id;
    return this.zonesService.create(createZoneDto);
  }
}
`,
  zones: `import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ZonesService } from './zones.service.js';
import { CreateZoneDto } from './dto/create-zone.dto.js';
import { UpdateZoneDto } from './dto/update-zone.dto.js';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Zones')
@Controller('zones')
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  @Get()
  findAll() {
    return this.zonesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.zonesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateZoneDto: UpdateZoneDto) {
    return this.zonesService.update(id, updateZoneDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.zonesService.remove(id);
  }
}
`,
  devices: `import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { DevicesService } from './devices.service.js';
import { CreateDeviceDto } from './dto/create-device.dto.js';
import { UpdateDeviceDto } from './dto/update-device.dto.js';
import { CreateSensorDto } from '../sensors/dto/create-sensor.dto.js';
import { SensorsService } from '../sensors/sensors.service.js';
import { CreateActuatorDto } from '../actuators/dto/create-actuator.dto.js';
import { ActuatorsService } from '../actuators/actuators.service.js';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Devices')
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devicesService: DevicesService,
    private readonly sensorsService: SensorsService,
    private readonly actuatorsService: ActuatorsService
  ) {}

  @Post()
  create(@Body() createDeviceDto: CreateDeviceDto) {
    return this.devicesService.create(createDeviceDto);
  }

  @Get()
  findAll() {
    return this.devicesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.devicesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDeviceDto: UpdateDeviceDto) {
    return this.devicesService.update(id, updateDeviceDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.devicesService.remove(id);
  }

  @Get(':id/sensors')
  findSensors(@Param('id') id: string) {
    return this.devicesService.findSensors(id);
  }

  @Post(':id/sensors')
  createSensor(@Param('id') id: string, @Body() createSensorDto: CreateSensorDto) {
    createSensorDto.deviceId = id;
    return this.sensorsService.create(createSensorDto);
  }

  @Get(':id/actuators')
  findActuators(@Param('id') id: string) {
    return this.devicesService.findActuators(id);
  }

  @Post(':id/actuators')
  createActuator(@Param('id') id: string, @Body() createActuatorDto: CreateActuatorDto) {
    createActuatorDto.deviceId = id;
    return this.actuatorsService.create(createActuatorDto);
  }
}
`,
  sensors: `import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { SensorsService } from './sensors.service.js';
import { CreateSensorDto } from './dto/create-sensor.dto.js';
import { UpdateSensorDto } from './dto/update-sensor.dto.js';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Sensors')
@Controller('sensors')
export class SensorsController {
  constructor(private readonly sensorsService: SensorsService) {}

  @Get()
  findAll() {
    return this.sensorsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sensorsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSensorDto: UpdateSensorDto) {
    return this.sensorsService.update(id, updateSensorDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.sensorsService.remove(id);
  }
}
`,
  actuators: `import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ActuatorsService } from './actuators.service.js';
import { CreateActuatorDto } from './dto/create-actuator.dto.js';
import { UpdateActuatorDto } from './dto/update-actuator.dto.js';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Actuators')
@Controller('actuators')
export class ActuatorsController {
  constructor(private readonly actuatorsService: ActuatorsService) {}

  @Get()
  findAll() {
    return this.actuatorsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.actuatorsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateActuatorDto: UpdateActuatorDto) {
    return this.actuatorsService.update(id, updateActuatorDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.actuatorsService.remove(id);
  }
}
`
};

Object.keys(dtos).forEach(mod => {
  const modDir = path.join(srcDir, mod);
  if (!fs.existsSync(modDir)) fs.mkdirSync(modDir);
  const dtoDir = path.join(modDir, 'dto');
  if (!fs.existsSync(dtoDir)) fs.mkdirSync(dtoDir);

  let mname = mod;
  if (mod === 'organizations') mname = 'organization';
  if (mod === 'greenhouses') mname = 'greenhouse';
  if (mod === 'zones') mname = 'zone';
  if (mod === 'devices') mname = 'device';
  if (mod === 'sensors') mname = 'sensor';
  if (mod === 'actuators') mname = 'actuator';

  fs.writeFileSync(path.join(dtoDir, 'create-' + mname + '.dto.ts'), dtos[mod].create);
  fs.writeFileSync(path.join(dtoDir, 'update-' + mname + '.dto.ts'), dtos[mod].update);
  fs.writeFileSync(path.join(modDir, mod + '.service.ts'), services[mod]);
  fs.writeFileSync(path.join(modDir, mod + '.controller.ts'), controllers[mod]);
});

console.log('Setup finished');
