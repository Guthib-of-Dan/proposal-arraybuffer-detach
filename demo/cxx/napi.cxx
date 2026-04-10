#include <cstdint>
#include <napi.h>
using namespace Napi;
using args_t = const CallbackInfo&;
constexpr const uint16_t MEM_SIZE = 1024*10;
constexpr uint8_t cbArgc = 1;
uint32_t iterations = 500'000;
char memory[MEM_SIZE]; 

Reference<Function> autoRef;
Reference<Function> manualRef;

namespace exports {
  void setLoopAutoDetach(const Napi::CallbackInfo &info) {
    const Napi::Function cb = info[0].As<Napi::Function>();
    autoRef = Napi::Reference<Napi::Function>::New(cb, 1);
  }
  void loopAutoDetach(const Napi::CallbackInfo &info) {
    Napi::Function cb = autoRef.Value();
    for(uint64_t i = iterations; i > 0; i--) {
      Napi::ArrayBuffer ab = Napi::ArrayBuffer::New(info.Env(), memory, MEM_SIZE);
      cb.Call({ab});
      ab.Detach();
    }
  }
  void setLoopManualDetach(const Napi::CallbackInfo &info) {
    const Napi::Function cb = info[0].As<Napi::Function>();
    manualRef = Napi::Reference<Napi::Function>::New(cb, 1);
  }
  void loopManualDetach(const Napi::CallbackInfo &info) {
    const Napi::Function cb = manualRef.Value();

    for(uint64_t i = iterations; i > 0; i--) {
Napi::ArrayBuffer ab = Napi::ArrayBuffer::New(info.Env(), memory, MEM_SIZE);
      cb.Call({ab});
      // detached buffer here is expected
    }
  }
  void manualDetach(const Napi::CallbackInfo &info) {
    info[0].As<Napi::ArrayBuffer>().Detach();
  }
  void setIterations(const Napi::CallbackInfo &info) {
    iterations = info[0].As<Napi::Number>().Int32Value();
  }
} 
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("setLoopAutoDetach", Napi::Function::New(env, exports::setLoopAutoDetach));
  exports.Set("loopAutoDetach", Napi::Function::New(env, exports::loopAutoDetach));
  exports.Set("loopManualDetach", Napi::Function::New(env, exports::loopManualDetach));
  exports.Set("setLoopManualDetach", Napi::Function::New(env, exports::setLoopManualDetach));
  exports.Set("manualDetach", Napi::Function::New(env, exports::manualDetach));
  exports.Set("setIterations", Napi::Function::New(env, exports::setIterations));
  return exports;
}
NODE_API_MODULE(napi, Init)
