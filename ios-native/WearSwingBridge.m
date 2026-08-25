/**
 * 2026-08-25 — Objective-C bridge for the WearSwingBridge Swift module (Apple Watch).
 *
 * Same module name as the Android Wear OS module on purpose: the JS bridges
 * (services/watchCaddieBridge.ts, services/watchSwingBridge.ts) then need no platform branch.
 * Implementation lives in WearSwingBridgeModule.swift.
 */

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(WearSwingBridge, RCTEventEmitter)

RCT_EXTERN_METHOD(start:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getStatus:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(sendToWatch:(NSString *)path
                  data:(NSString *)data
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
