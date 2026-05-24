/**
 * 2026-05-24 — Objective-C bridge for BluetoothMediaButton Swift module.
 *
 * RN's Swift bindings require a `.m` file that declares the module +
 * its exported methods so the bridge can see them at runtime. The
 * actual implementation lives in BluetoothMediaButtonModule.swift.
 */

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(BluetoothMediaButton, RCTEventEmitter)

RCT_EXTERN_METHOD(activate:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(deactivate:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getStatus:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)

@end
