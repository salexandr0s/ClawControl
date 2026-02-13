'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { LoadingSpinner } from '@/components/ui/loading-state'

export type AsciiDensity = 'fine' | 'normal' | 'chunky'

interface DensityPreset {
  sample: number
  resolution: number
  fontSizePx: number
  cellSize: number
}

const DENSITY_PRESETS: Record<AsciiDensity, DensityPreset> = {
  fine: { sample: 120, resolution: 0.12, fontSizePx: 7, cellSize: 0.72 },
  normal: { sample: 90, resolution: 0.16, fontSizePx: 8, cellSize: 0.82 },
  chunky: { sample: 64, resolution: 0.24, fontSizePx: 10, cellSize: 0.95 },
}

interface AsciiLogoViewerProps {
  src: string
  density: AsciiDensity
  invert: boolean
  autoRotate: boolean
  resetNonce: number
  className?: string
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`))
    img.src = src
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function buildVoxelLogo(
  THREE: typeof import('three'),
  img: HTMLImageElement,
  opts: {
    sample: number
    cellSize: number
    maxDepth: number
    minDepth: number
    alphaThreshold: number
  }
) {
  const { sample, cellSize, maxDepth, minDepth, alphaThreshold } = opts

  const canvas = document.createElement('canvas')
  canvas.width = sample
  canvas.height = sample

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable')
  }

  ctx.clearRect(0, 0, sample, sample)

  const scale = Math.min(sample / img.width, sample / img.height)
  const drawW = img.width * scale
  const drawH = img.height * scale
  const dx = (sample - drawW) / 2
  const dy = (sample - drawH) / 2
  ctx.drawImage(img, dx, dy, drawW, drawH)

  const imageData = ctx.getImageData(0, 0, sample, sample)
  const data = imageData.data

  // Count instances first (needed for InstancedMesh allocation).
  let instanceCount = 0
  for (let y = 0; y < sample; y += 1) {
    for (let x = 0; x < sample; x += 1) {
      const i = (y * sample + x) * 4
      const a = data[i + 3] / 255
      if (a > alphaThreshold) instanceCount += 1
    }
  }

  // Always allocate at least 1 instance so we can render a stable empty state.
  const safeCount = Math.max(1, instanceCount)
  const box = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.55,
    metalness: 0.12,
  })

  const mesh = new THREE.InstancedMesh(box, material, safeCount)
  mesh.castShadow = false
  mesh.receiveShadow = false

  const dummy = new THREE.Object3D()
  const half = (sample - 1) / 2

  const depthSpan = Math.max(0.0001, maxDepth - minDepth)
  const packedMinDepth = clamp(minDepth, 0.0001, maxDepth)

  let instanceIndex = 0
  for (let y = 0; y < sample; y += 1) {
    for (let x = 0; x < sample; x += 1) {
      const i = (y * sample + x) * 4
      const a = data[i + 3] / 255
      if (a <= alphaThreshold) continue

      // Gamma curve makes the logo read as "solid" rather than hollow.
      const h = Math.pow(a, 0.8)
      const scaleZ = packedMinDepth + h * depthSpan

      const posX = (x - half) * cellSize
      const posY = (half - y) * cellSize
      const posZ = -maxDepth / 2 + scaleZ / 2

      dummy.position.set(posX, posY, posZ)
      dummy.scale.set(cellSize * 0.92, cellSize * 0.92, scaleZ)
      dummy.updateMatrix()
      mesh.setMatrixAt(instanceIndex, dummy.matrix)
      instanceIndex += 1

      if (instanceIndex >= safeCount) break
    }
    if (instanceIndex >= safeCount) break
  }

  // If the image was fully transparent for some reason, place a single tiny cube at origin.
  if (instanceCount === 0) {
    dummy.position.set(0, 0, 0)
    dummy.scale.set(0.5, 0.5, 0.5)
    dummy.updateMatrix()
    mesh.setMatrixAt(0, dummy.matrix)
  }

  mesh.instanceMatrix.needsUpdate = true

  return {
    mesh,
    dispose: () => {
      box.dispose()
      material.dispose()
    },
  }
}

export function AsciiLogoViewer({
  src,
  density,
  invert,
  autoRotate,
  resetNonce,
  className,
}: AsciiLogoViewerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const controlsRef = useRef<any>(null)
  const meshRef = useRef<any>(null)
  const initialLogoRotationRef = useRef<{ x: number; y: number; z: number } | null>(null)

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorText, setErrorText] = useState<string | null>(null)

  const preset = useMemo(() => DENSITY_PRESETS[density], [density])

  // Rebuild renderer/effect/mesh when density, invert, or source changes.
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let canceled = false
    let rafId: number | null = null
    let ro: ResizeObserver | null = null

    // Runtime objects we clean up on teardown.
    let renderer: any = null
    let effect: any = null
    let scene: any = null
    let camera: any = null
    let controls: any = null
    let instancedDispose: (() => void) | null = null

    setStatus('loading')
    setErrorText(null)

    const bg = mount.parentElement
    if (bg) {
      bg.style.background = 'radial-gradient(1200px 600px at 20% 20%, rgba(64,140,255,0.18), rgba(0,0,0,0) 55%), radial-gradient(900px 500px at 80% 70%, rgba(0,255,200,0.08), rgba(0,0,0,0) 60%), linear-gradient(180deg, rgba(10,12,16,1), rgba(7,8,10,1))'
    }

    void (async () => {
      try {
        const THREE = await import('three')
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
        const { AsciiEffect } = await import('three/examples/jsm/effects/AsciiEffect.js')

        if (canceled) return

        scene = new THREE.Scene()

        camera = new THREE.PerspectiveCamera(44, 1, 0.1, 2000)
        camera.position.set(0, 0, 150)

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))

        effect = new AsciiEffect(renderer, ' .:-=+*#%@', {
          invert,
          color: false,
          resolution: preset.resolution,
        })

        effect.domElement.style.display = 'block'
        effect.domElement.style.width = '100%'
        effect.domElement.style.height = '100%'
        effect.domElement.style.overflow = 'hidden'
        effect.domElement.style.backgroundColor = 'transparent'
        effect.domElement.style.color = 'rgba(214, 233, 255, 0.92)'
        effect.domElement.style.fontFamily =
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
        effect.domElement.style.fontSize = `${preset.fontSizePx}px`
        effect.domElement.style.lineHeight = `${preset.fontSizePx}px`
        effect.domElement.style.userSelect = 'none'
        effect.domElement.style.cursor = 'grab'

        mount.replaceChildren(effect.domElement)

        controls = new OrbitControls(camera, effect.domElement)
        controls.enableDamping = true
        controls.dampingFactor = 0.08
        controls.enablePan = false
        controls.minDistance = 70
        controls.maxDistance = 420
        controls.autoRotate = autoRotate
        controls.autoRotateSpeed = 0.9
        controls.update()
        controls.saveState?.()

        controlsRef.current = controls

        const ambient = new THREE.AmbientLight(0xffffff, 0.35)
        scene.add(ambient)

        const key = new THREE.DirectionalLight(0xffffff, 0.95)
        key.position.set(1.6, 2.0, 2.6)
        scene.add(key)

        const fill = new THREE.DirectionalLight(0xffffff, 0.35)
        fill.position.set(-2.0, -1.2, 1.0)
        scene.add(fill)

        const rim = new THREE.DirectionalLight(0xffffff, 0.25)
        rim.position.set(-1.4, 1.4, -2.0)
        scene.add(rim)

        const img = await loadImage(src)
        if (canceled) return

        const maxDepth = 18
        const minDepth = 2.0
        const alphaThreshold = 0.12

        const { mesh, dispose } = buildVoxelLogo(THREE, img, {
          sample: preset.sample,
          cellSize: preset.cellSize,
          maxDepth,
          minDepth,
          alphaThreshold,
        })

        instancedDispose = dispose
        meshRef.current = mesh

        // Default "hero" rotation: makes depth obvious in ASCII.
        const initialRotation = { x: -0.22, y: 0.68, z: 0 }
        initialLogoRotationRef.current = initialRotation
        mesh.rotation.set(initialRotation.x, initialRotation.y, initialRotation.z)
        scene.add(mesh)

        // Fit-ish: keep the logo centered and fully visible.
        const approxSize = preset.sample * preset.cellSize
        const fitDist = clamp(approxSize * 1.35, 120, 320)
        camera.position.set(0, 0, fitDist)
        controls.update()
        controls.saveState?.()

        const resize = () => {
          const rect = mount.getBoundingClientRect()
          const w = Math.max(1, Math.floor(rect.width))
          const h = Math.max(1, Math.floor(rect.height))
          camera.aspect = w / h
          camera.updateProjectionMatrix()
          effect.setSize(w, h)
        }

        resize()
        ro = new ResizeObserver(resize)
        ro.observe(mount)

        setStatus('ready')

        const tick = () => {
          if (canceled) return
          rafId = requestAnimationFrame(tick)
          controls.update()
          effect.render(scene, camera)
        }
        tick()
      } catch (err) {
        if (canceled) return
        setStatus('error')
        setErrorText(err instanceof Error ? err.message : 'Failed to initialize ASCII viewer')
      }
    })()

    return () => {
      canceled = true

      if (rafId !== null) cancelAnimationFrame(rafId)
      if (ro) ro.disconnect()

      try {
        controls?.dispose?.()
      } catch {
        // ignore
      }

      controlsRef.current = null
      meshRef.current = null
      initialLogoRotationRef.current = null

      try {
        mount.replaceChildren()
      } catch {
        // ignore
      }

      try {
        instancedDispose?.()
      } catch {
        // ignore
      }

      try {
        renderer?.dispose?.()
      } catch {
        // ignore
      }
    }
  }, [src, preset, invert])

  // Auto-rotate toggle without rebuilding the scene.
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    controls.autoRotate = autoRotate
  }, [autoRotate])

  // Reset camera + logo orientation.
  useEffect(() => {
    const controls = controlsRef.current
    if (controls?.reset) controls.reset()

    const mesh = meshRef.current
    const rot = initialLogoRotationRef.current
    if (mesh && rot) {
      mesh.rotation.set(rot.x, rot.y, rot.z)
    }
  }, [resetNonce])

  return (
    <div className={cn('relative min-h-[520px]', className)}>
      <div className="absolute inset-0 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden bg-bg-1">
        <div ref={mountRef} className="w-full h-full" />
      </div>

      {status !== 'ready' ? (
        <div className="relative z-10 pointer-events-none flex items-center justify-center min-h-[520px] text-fg-2">
          {status === 'loading' ? (
            <div className="flex items-center gap-2 text-sm">
              <LoadingSpinner size="md" className="text-fg-2" />
              <span>Building ASCII model...</span>
            </div>
          ) : (
            <div className="text-sm max-w-lg text-center px-4">
              <div className="font-medium text-fg-1">ASCII viewer failed</div>
              {errorText ? <div className="mt-1 text-xs text-fg-3">{errorText}</div> : null}
            </div>
          )}
        </div>
      ) : null}

      <div className="relative z-10 pointer-events-none p-3">
        <div className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-bd-0 bg-bg-0/70 backdrop-blur px-2.5 py-1.5 text-xs text-fg-2">
          <span className="text-fg-1">Tip:</span>
          <span>drag</span>
          <span className="text-fg-3">|</span>
          <span>scroll</span>
          <span className="text-fg-3">|</span>
          <span>reset</span>
        </div>
      </div>
    </div>
  )
}

