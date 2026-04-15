/**
 * BiometricService.js
 *
 * Thin wrapper around expo-local-authentication.
 *
 * Kept deliberately small so it can be safely called from any screen
 * without introducing cross-component coupling.
 */

import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Returns true if the device has biometric hardware AND enrolled credentials.
 * Silently returns false on any error (e.g. simulator / older device).
 *
 * @returns {Promise<boolean>}
 */
export async function checkBiometricSupport() {
  try {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    if (!compatible) return false;
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return enrolled;
  } catch {
    return false;
  }
}

/**
 * Trigger the system biometric / passcode prompt.
 *
 * @returns {Promise<boolean>} true if authentication succeeded
 */
export async function authenticateUser() {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage:          'Unlock Caddie',
      fallbackLabel:          'Use Passcode',
      disableDeviceFallback:  false,
      cancelLabel:            'Cancel',
    });
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Returns the list of authentication types available on the device
 * (e.g. FINGERPRINT, FACIAL_RECOGNITION, IRIS).
 * Useful for customising the button label.
 *
 * @returns {Promise<LocalAuthentication.AuthenticationType[]>}
 */
export async function getSupportedTypes() {
  try {
    return await LocalAuthentication.supportedAuthenticationTypesAsync();
  } catch {
    return [];
  }
}
