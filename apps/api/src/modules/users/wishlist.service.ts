import { Injectable } from '@nestjs/common'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string) {
    return this.prisma.wishlistItem.findMany({
      where: { userId },
      include: {
        product: {
          select: {
            id: true,
            slug: true,
            basePrice: true,
            salePrice: true,
            isActive: true,
            translations: {
              select: { language: true, name: true },
            },
            images: {
              where: { isPrimary: true },
              select: { url: true, altText: true },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async add(userId: string, productId: string, notifyWhenAvailable = false) {
    // Check product exists
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
    })
    if (!product) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'ProductNotFound',
        message: {
          de: 'Produkt nicht gefunden.',
          en: 'Product not found.',
          ar: 'المنتج غير موجود.',
        },
      })
    }

    try {
      return await this.prisma.wishlistItem.create({
        data: { userId, productId, notifyWhenAvailable },
      })
    } catch {
      throw new ConflictException({
        statusCode: 409,
        error: 'AlreadyInWishlist',
        message: {
          de: 'Produkt ist bereits auf der Wunschliste.',
          en: 'Product is already in the wishlist.',
          ar: 'المنتج موجود بالفعل في قائمة الأمنيات.',
        },
      })
    }
  }

  async remove(userId: string, productId: string): Promise<void> {
    const item = await this.prisma.wishlistItem.findFirst({
      where: { userId, productId },
    })
    if (!item) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'NotInWishlist',
        message: {
          de: 'Produkt ist nicht auf der Wunschliste.',
          en: 'Product is not in the wishlist.',
          ar: 'المنتج ليس في قائمة الأمنيات.',
        },
      })
    }

    await this.prisma.wishlistItem.delete({ where: { id: item.id } })
  }

  async toggleNotify(userId: string, productId: string, notify: boolean) {
    const item = await this.prisma.wishlistItem.findFirst({
      where: { userId, productId },
    })
    if (!item) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'NotInWishlist',
        message: {
          de: 'Produkt ist nicht auf der Wunschliste.',
          en: 'Product is not in the wishlist.',
          ar: 'المنتج ليس في قائمة الأمنيات.',
        },
      })
    }

    return this.prisma.wishlistItem.update({
      where: { id: item.id },
      data: { notifyWhenAvailable: notify },
    })
  }
}
