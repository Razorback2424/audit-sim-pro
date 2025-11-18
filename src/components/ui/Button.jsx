import React from 'react';
import { Loader2 } from 'lucide-react';

export const Button = React.forwardRef(
  (
    {
      onClick,
      children,
      variant = 'primary',
      className = '',
      type = 'button',
      disabled = false,
      isLoading = false,
      ...props
    },
    ref
  ) => {
    const baseStyle =
      'px-4 py-2 rounded-md font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-opacity-75 transition-colors duration-150 inline-flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed';
    const variants = {
      primary: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500',
      secondary: 'bg-gray-100 hover:bg-gray-200 text-gray-800 focus:ring-gray-400',
      danger: 'bg-red-500 hover:bg-red-600 text-white focus:ring-red-500',
    };
    return (
      <button
        type={type}
        onClick={onClick}
        className={`${baseStyle} ${variants[variant] || variants.primary} ${className}`}
        disabled={disabled || isLoading}
        ref={ref}
        {...props}
      >
        {isLoading && <Loader2 size={18} className="animate-spin mr-2" />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
