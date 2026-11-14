#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(GlassPlayerPlugin, "GlassPlayer",
    CAP_PLUGIN_METHOD(enable, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(disable, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setTrack, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setPlaying, CAPPluginReturnPromise);
)
