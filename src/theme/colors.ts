import { Platform } from 'react-native';

export const theme = {
  colors: {
    background: '#0B0F0C', // Very dark green/black (Terminal BG)
    card: '#161B16', // Dark green grey
    text: '#E5E7EB', // Off-White/Light Grey
    textSecondary: '#889288', // Desaturated green-grey
    primary: '#F97316', // High-vis safety orange
    secondary: '#EAB308', // High-vis yellow
    success: '#10B981', // Terminal green
    warning: '#F59E0B', // Amber
    danger: '#EF4444', // Emergency red
    border: '#232D23', // Dark olive border
    surface: '#1E251E', // Elevated surface
    surfaceHighlight: '#2A332A', // For depth
  },
  spacing: {
    xs: 4,
    s: 8,
    m: 16,
    l: 24,
    xl: 32,
  },
  typography: {
    mono: Platform.select({ ios: 'Courier', android: 'monospace' }),
  }
};