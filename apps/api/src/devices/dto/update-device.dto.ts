import { PartialType } from '@nestjs/swagger';
import { CreateDeviceDto } from './create-device.dto.js';

export class UpdateDeviceDto extends PartialType(CreateDeviceDto) {}
