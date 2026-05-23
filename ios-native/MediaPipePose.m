// 2026-05-23 — RCT bridge header for MediaPipePoseModule.swift. Same
// pattern as ios-native/MetaWearablesFrame.m — exposes the Swift
// @objc methods to React Native's NativeModules surface.

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(MediaPipePose, NSObject)

RCT_EXTERN_METHOD(detectPoseFromFrame:(NSString *)b64
                  options:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(getStatus:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(startContinuousDetection:(NSString *)quality
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(stopContinuousDetection:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(close:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

@end
