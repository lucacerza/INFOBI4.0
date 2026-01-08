/**
 * Skeleton Loading Components
 * Professional loading states that replace spinners
 */
import React from 'react';

export const SkeletonRow: React.FC<{ columns?: number }> = ({ columns = 4 }) => {
  return (
    <div className="flex items-center space-x-4 py-3 px-4 border-b border-gray-100">
      {Array(columns).fill(0).map((_, idx) => (
        <div
          key={idx}
          className="h-4 bg-gray-200 rounded animate-shimmer"
          style={{ 
            width: idx === 0 ? '30%' : '20%',
            backgroundImage: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
            backgroundSize: '200% 100%'
          }}
        />
      ))}
    </div>
  );
};

export const SkeletonTable: React.FC<{ rows?: number; columns?: number }> = ({ 
  rows = 10, 
  columns = 4 
}) => {
  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      {/* Header skeleton */}
      <div className="flex items-center space-x-4 py-3 px-4 bg-gray-50 border-b border-gray-200">
        {Array(columns).fill(0).map((_, idx) => (
          <div
            key={idx}
            className="h-5 bg-gray-300 rounded animate-shimmer"
            style={{ 
              width: idx === 0 ? '30%' : '20%',
              backgroundImage: 'linear-gradient(90deg, #e0e0e0 25%, #d0d0d0 50%, #e0e0e0 75%)',
              backgroundSize: '200% 100%'
            }}
          />
        ))}
      </div>
      
      {/* Body rows skeleton */}
      {Array(rows).fill(0).map((_, rowIdx) => (
        <SkeletonRow key={rowIdx} columns={columns} />
      ))}
    </div>
  );
};

export const SkeletonCard: React.FC = () => {
  return (
    <div className="bg-white rounded-lg shadow-sm p-6 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-1/3 mb-4"></div>
      <div className="h-8 bg-gray-300 rounded w-2/3 mb-2"></div>
      <div className="h-3 bg-gray-200 rounded w-1/2"></div>
    </div>
  );
};

export const SkeletonPivot: React.FC = () => {
  return (
    <div className="h-full flex flex-col">
      {/* Toolbar skeleton */}
      <div className="flex items-center justify-between p-4 bg-white border-b border-gray-200">
        <div className="flex space-x-2">
          <div className="h-9 w-24 bg-gray-200 rounded animate-shimmer"></div>
          <div className="h-9 w-24 bg-gray-200 rounded animate-shimmer"></div>
        </div>
        <div className="h-9 w-32 bg-gray-200 rounded animate-shimmer"></div>
      </div>
      
      {/* Table skeleton */}
      <div className="flex-1 overflow-hidden">
        <SkeletonTable rows={15} columns={6} />
      </div>
    </div>
  );
};

// Add shimmer animation to tailwind
// You'll need to add this to tailwind.config.js:
/*
module.exports = {
  theme: {
    extend: {
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        }
      },
      animation: {
        shimmer: 'shimmer 2s infinite linear'
      }
    }
  }
}
*/
