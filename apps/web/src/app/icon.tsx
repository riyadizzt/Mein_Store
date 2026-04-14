import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: '#1a1a2e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            color: '#d4a853',
            fontSize: 15,
            fontWeight: 700,
            fontFamily: 'Georgia, serif',
            letterSpacing: -0.5,
          }}
        >
          MB
        </span>
      </div>
    ),
    { ...size },
  )
}
