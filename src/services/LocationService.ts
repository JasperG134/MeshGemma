import * as Location from 'expo-location';

export type Coords = { lat: number; lng: number; accuracy?: number };

class LocationService {
  private permissionGranted = false;
  private permissionChecked = false;
  private lastKnown: Coords | null = null;

  async requestPermission(): Promise<boolean> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      this.permissionGranted = status === 'granted';
      this.permissionChecked = true;
      return this.permissionGranted;
    } catch (err) {
      console.warn('LocationService.requestPermission failed:', err);
      this.permissionGranted = false;
      this.permissionChecked = true;
      return false;
    }
  }

  hasPermission(): boolean {
    return this.permissionGranted;
  }

  async getCurrentCoords(timeoutMs = 8000): Promise<Coords | null> {
    if (!this.permissionChecked || !this.permissionGranted) {
      const granted = await this.requestPermission();
      if (!granted) {
        throw new Error('Location permission denied');
      }
    }

    try {
      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) {
        console.warn('LocationService: location services disabled');
        return null;
      }
    } catch (err) {
      console.warn('LocationService.hasServicesEnabledAsync failed:', err);
      return null;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const fixPromise = Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }).then<Coords>((pos) => ({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? undefined,
      }));

      const timeoutPromise = new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(`LocationService.getCurrentCoords timed out after ${timeoutMs}ms`);
          resolve(null);
        }, timeoutMs);
      });

      const result = await Promise.race<Coords | null>([fixPromise, timeoutPromise]);
      if (result) {
        this.lastKnown = result;
      }
      return result;
    } catch (err) {
      console.warn('LocationService.getCurrentCoords failed:', err);
      return null;
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }
  }

  async watchCoords(cb: (c: Coords) => void): Promise<() => void> {
    if (!this.permissionChecked || !this.permissionGranted) {
      const granted = await this.requestPermission();
      if (!granted) {
        throw new Error('Location permission denied');
      }
    }

    try {
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 10,
          timeInterval: 5000,
        },
        (pos) => {
          const coords: Coords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? undefined,
          };
          this.lastKnown = coords;
          cb(coords);
        },
      );

      return () => {
        subscription.remove();
      };
    } catch (err) {
      console.warn('LocationService.watchCoords failed:', err);
      return () => {};
    }
  }

  getLastKnown(): Coords | null {
    return this.lastKnown;
  }
}

export const locationService = new LocationService();
