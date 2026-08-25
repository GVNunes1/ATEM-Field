import { useCallback, useEffect, useRef } from 'react';
import { Eraser, PenLine } from 'lucide-react';

interface SignaturePadProps {
  id: string;
  label: string;
  hint: string;
  value?: string;
  onChange: (base64Data: string) => void;
}

export function SignaturePad({ id, label, hint, value, onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  const drawStoredValue = useCallback((dataUrl?: string) => {
    const canvas = canvasRef.current;
    if (!canvas || !dataUrl) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = dataUrl;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const snapshot = value || (canvas.width ? canvas.toDataURL('image/png') : '');
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(Math.round(rect.width * ratio), 1);
      canvas.height = Math.max(Math.round(rect.height * ratio), 1);
      const context = canvas.getContext('2d');
      if (context) {
        context.lineWidth = 2.2 * ratio;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.strokeStyle = '#162033';
      }
      drawStoredValue(snapshot);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drawStoredValue]);

  useEffect(() => {
    if (value) drawStoredValue(value);
  }, [drawStoredValue, value]);

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height)
    };
  };

  const startDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const point = pointerPosition(event);
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo(point.x, point.y);
  };

  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const point = pointerPosition(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const stopDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const context = event.currentTarget.getContext('2d');
    context?.closePath();
    onChange(event.currentTarget.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    onChange('');
  };

  return (
    <div className="os-signature-field">
      <div className="os-signature-heading">
        <div>
          <label htmlFor={id}>
            <PenLine size={16} /> {label}
          </label>
          <p>{hint}</p>
        </div>
        <button type="button" className="os-button os-button--danger-quiet" onClick={clear}>
          <Eraser size={16} /> Limpar
        </button>
      </div>
      <div className="os-signature-canvas-wrap">
        <canvas
          ref={canvasRef}
          id={id}
          className="os-signature-canvas"
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerCancel={stopDrawing}
          aria-label={label}
        />
        <span aria-hidden="true">Assine dentro do quadro</span>
      </div>
    </div>
  );
}
