// shadcn/ui className merge helper: combines clsx + tailwind-merge so later
// Tailwind utilities win over earlier conflicting ones.
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
