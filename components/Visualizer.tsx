import React, { useEffect, useRef } from 'react';
import { AudioVisualizerProps } from '../types';

const Visualizer: React.FC<AudioVisualizerProps> = ({ analyser, isActive, accentColor = '#06b6d4' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const bufferLength = analyser ? analyser.frequencyBinCount : 0;
    const dataArray = analyser ? new Uint8Array(bufferLength) : new Uint8Array(0);

    const draw = () => {
      animationId = requestAnimationFrame(draw);

      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) / 3;

      ctx.clearRect(0, 0, width, height);

      // Draw Base Ring
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.strokeStyle = isActive ? accentColor : '#1e293b'; // Active vs Inactive color
      ctx.lineWidth = 2;
      ctx.stroke();

      if (!isActive || !analyser) {
        // Idle animation (slow pulsating inner circle)
        const time = Date.now() / 1000;
        const idleRadius = radius * 0.5 + Math.sin(time) * 10;
        ctx.beginPath();
        ctx.arc(centerX, centerY, idleRadius, 0, 2 * Math.PI);
        ctx.fillStyle = isActive ? `${accentColor}33` : '#1e293b33';
        ctx.fill();
        return;
      }

      analyser.getByteFrequencyData(dataArray);

      // Draw Frequency Bars (Circular)
      const bars = 60;
      const step = (Math.PI * 2) / bars;

      ctx.beginPath();
      for (let i = 0; i < bars; i++) {
        const dataIndex = Math.floor((i / bars) * bufferLength * 0.5); // Use lower half of freq
        const value = dataArray[dataIndex];
        const barHeight = (value / 255) * (radius * 0.8); // Scale height
        
        const angle = i * step;
        
        // Start point on circle
        const x1 = centerX + Math.cos(angle) * radius;
        const y1 = centerY + Math.sin(angle) * radius;
        
        // End point outwards
        const x2 = centerX + Math.cos(angle) * (radius + barHeight + 5);
        const y2 = centerY + Math.sin(angle) * (radius + barHeight + 5);

        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Inner Glow
      const avg = dataArray.reduce((a, b) => a + b, 0) / bufferLength;
      const glowRadius = radius * 0.4 + (avg / 255) * (radius * 0.4);
      
      const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, glowRadius * 1.5);
      gradient.addColorStop(0, `${accentColor}FF`);
      gradient.addColorStop(1, `${accentColor}00`);
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, glowRadius, 0, 2 * Math.PI);
      ctx.fillStyle = gradient;
      ctx.fill();
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [analyser, isActive, accentColor]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={600}
      className="w-full h-full max-w-[500px] max-h-[500px]"
    />
  );
};

export default Visualizer;