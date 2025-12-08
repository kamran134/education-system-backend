import sharp from 'sharp';

/**
 * Умный кроп изображения (центральный кроп с соотношением 3:4)
 * Face detection отключен из-за проблем совместимости с ESM
 * @param inputBuffer - Buffer изображения
 * @param targetWidth - целевая ширина (default: 600)
 * @param targetHeight - целевая высота (default: 800)
 * @returns Buffer обработанного изображения
 */
export async function smartCrop(
    inputBuffer: Buffer,
    targetWidth: number = 600,
    targetHeight: number = 800
): Promise<Buffer> {
    // Получаем метаданные изображения
    const metadata = await sharp(inputBuffer).metadata();
    const { width = 0, height = 0 } = metadata;

    // Используем центральный кроп с соотношением 3:4
    const aspectRatio = targetWidth / targetHeight;
    let cropWidth: number;
    let cropHeight: number;

    if (width / height > aspectRatio) {
        // Изображение шире, чем нужно - обрезаем по ширине
        cropHeight = height;
        cropWidth = height * aspectRatio;
    } else {
        // Изображение выше, чем нужно - обрезаем по высоте
        cropWidth = width;
        cropHeight = width / aspectRatio;
    }

    const cropRegion = {
        left: Math.round((width - cropWidth) / 2),
        top: Math.round((height - cropHeight) / 2),
        width: Math.round(cropWidth),
        height: Math.round(cropHeight)
    };

    // Кропаем и ресайзим до целевого размера
    return sharp(inputBuffer)
        .extract(cropRegion)
        .resize(targetWidth, targetHeight, {
            fit: 'cover',
            position: 'center'
        })
        .jpeg({ quality: 80 })
        .toBuffer();
}

/**
 * Проверка доступности face detection
 * @returns false (face detection отключен)
 */
export function isFaceDetectionAvailable(): boolean {
    return false;
}
