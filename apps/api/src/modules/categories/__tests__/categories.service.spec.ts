/**
 * CategoriesService unit tests — Size-Charts Hardening (Gruppe).
 *
 * Specifically: pre-delete guard against orphaning attached SizeCharts.
 * Pre-hardening, deactivating a category silently orphaned every chart
 * attached to it — the chart stayed active but customers in that
 * category saw no size guide until someone manually re-linked them.
 *
 * The audit flagged this as a "structured 409" so the admin must
 * explicitly choose: detach charts first, or deactivate them too.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { CategoriesService } from '../categories.service'
import { PrismaService } from '../../../prisma/prisma.service'

function buildPrisma() {
  return {
    category: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    sizeChart: {
      findMany: jest.fn(),
    },
  }
}

async function makeService(prisma: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CategoriesService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile()
  return module.get(CategoriesService)
}

describe('CategoriesService.remove — pre-delete chart guard (Hardening G)', () => {
  it('throws 409 with structured 3-language message when charts are attached', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue({ id: 'cat-1', isActive: true })
    prisma.sizeChart.findMany.mockResolvedValue([
      { id: 'chart-1', name: 'Damen Tops' },
      { id: 'chart-2', name: 'Damen Tops Saison 2' },
    ])
    const service = await makeService(prisma)

    let thrown: any = null
    try {
      await service.remove('cat-1')
    } catch (err: any) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(ConflictException)
    const body = thrown.getResponse()
    expect(body.statusCode).toBe(409)
    expect(body.error).toBe('CategoryHasAttachedSizeCharts')
    // 3-language message structure (de/en/ar)
    expect(body.message.de).toContain('2')
    expect(body.message.en).toContain('2')
    expect(body.message.ar).toContain('2')
    // Data payload exposes the chart list so the UI can render it
    expect(body.data.attachedCharts).toHaveLength(2)
    // Crucially: prisma.category.update was NOT called — soft-delete blocked
    expect(prisma.category.update).not.toHaveBeenCalled()
  })

  it('proceeds with soft-delete when no charts are attached', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue({ id: 'cat-1', isActive: true })
    prisma.sizeChart.findMany.mockResolvedValue([])
    prisma.category.update.mockResolvedValue({ id: 'cat-1', isActive: false })
    const service = await makeService(prisma)

    await service.remove('cat-1')

    expect(prisma.category.update).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
      data: { isActive: false },
    })
  })

  it('throws NotFoundException when category does not exist', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue(null)
    const service = await makeService(prisma)

    await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException)
  })
})
