import React from 'react';

export default function FancySection({ title, children, className = '' }) {
  return (
    <div className={`fancy-section ${className}`}>
      <div className="heading-glow inline-block relative mb-6">
        <h2 className="gradient-heading text-3xl md:text-4xl font-bold">
          {title}
        </h2>
      </div>
      <div className="animate-entry">{children}</div>
    </div>
  );
}
