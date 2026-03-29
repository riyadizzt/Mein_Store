import { Injectable, Logger } from '@nestjs/common'
import {
  IShipmentProvider,
  CreateShipmentInput,
  ShipmentResult,
  CreateReturnLabelInput,
  ReturnLabelResult,
} from '../shipment-provider.interface'

/**
 * DPD Provider — STUB
 * Interface bereit. Implementierung erfolgt in einer späteren Phase.
 */
@Injectable()
export class DPDProvider implements IShipmentProvider {
  readonly providerName = 'dpd'
  private readonly logger = new Logger(DPDProvider.name)

  async createShipment(_input: CreateShipmentInput): Promise<ShipmentResult> {
    this.logger.warn('DPD provider is not yet implemented — stub only')
    throw new Error('DPD integration not yet available. Please use DHL.')
  }

  async deleteShipment(_providerShipmentId: string): Promise<void> {
    throw new Error('DPD deleteShipment not yet implemented.')
  }

  async createReturnLabel(_input: CreateReturnLabelInput): Promise<ReturnLabelResult> {
    throw new Error('DPD return label not yet implemented.')
  }
}
