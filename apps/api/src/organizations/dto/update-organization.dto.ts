import { PartialType } from '@nestjs/swagger';
import { CreateOrganizationDto } from './create-organization.dto.js';

export class UpdateOrganizationDto extends PartialType(CreateOrganizationDto) {}
