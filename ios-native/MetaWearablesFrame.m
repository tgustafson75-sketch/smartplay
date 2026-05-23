// 2026-05-23 — RCT bridge header for MetaWearablesFrameModule.swift.
//
// React Native can't talk to Swift modules directly; this Obj-C file
// declares the externally-callable surface that bridges to the Swift
// @objc methods. The withMetaWearablesDAT config plugin places both
// this .m file and the .swift sibling into the bare ios/ project at
// prebuild time. Bridging-Header.h (Expo template provides) handles
// the inverse mapping (Swift sees React/RCTEventEmitter.h).
//
// Without this file, NativeModules.MetaWearablesFrame resolves to
// `undefined` on iOS — exactly the same failure mode as forgetting
// to add MetaWearablesPackage to MainApplication.kt's getPackages on
// Android.

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(MetaWearablesFrame, RCTEventEmitter)

RCT_EXTERN_METHOD(startStreaming:(NSString *)quality
                  fps:(nonnull NSNumber *)fps
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(stopStreaming:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(getStatus:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

@end
