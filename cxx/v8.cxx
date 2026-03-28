#include <cstdint>
#include <v8.h>
#include <node.h>
using namespace v8;
using args_t = const FunctionCallbackInfo<Value>&;

constexpr const uint16_t MEM_SIZE = 1024*10;
constexpr uint8_t cbArgc = 1;
uint32_t iterations = 500'000;
char memory[MEM_SIZE]; 
void voidFinalizer(void*,size_t,void*) {};

Global<Function> autoRef;
Global<Function> manualRef;

namespace exports {
  void setLoopAutoDetach(args_t args) {
    autoRef.Reset(args.GetIsolate(), Local<Function>::Cast(args[0]));
  } 
  void setLoopManualDetach(args_t args) {
    manualRef.Reset(args.GetIsolate(), Local<Function>::Cast(args[0]));
  } 
  void loopAutoDetach(args_t args) {
    Isolate* isolate = args.GetIsolate();
    Local<Function> cb = autoRef.Get(isolate);
    Local<Context> context = isolate->GetCurrentContext();
    Local<Primitive> undefined = Undefined(isolate);
    for(uint32_t i = iterations; i > 0; i--) {
      Local<Value> maskedAb = ArrayBuffer::New(
          isolate,
          ArrayBuffer::NewBackingStore(memory, MEM_SIZE, voidFinalizer, nullptr) // unique_ptr -> shared_ptr implicit conversion
      );
      static_cast<void>(cb->Call(context, undefined, cbArgc, &maskedAb));
      Local<ArrayBuffer>::Cast(maskedAb)->Detach();
    }
  }
  void loopManualDetach(args_t args) {
    Isolate* isolate = args.GetIsolate();
    Local<Function> cb = manualRef.Get(isolate);
    Local<Context> context = isolate->GetCurrentContext();
    Local<Primitive> undefined = Undefined(isolate);
    for(uint32_t i = iterations; i > 0; i--) {
      Local<Value> maskedAb = ArrayBuffer::New(
          isolate,
          ArrayBuffer::NewBackingStore(memory, MEM_SIZE, voidFinalizer, nullptr) // unique_ptr -> shared_ptr implicit conversion
      );
      static_cast<void>(cb->Call(context, undefined, cbArgc, &maskedAb));
    }
  }
  void manualDetach(args_t args) {
    Local<ArrayBuffer>::Cast(args[0])->Detach();
  }
  void setIterations(args_t args) {
    iterations = Local<Number>::Cast(args[0])->Int32Value(
      args.GetIsolate()->GetCurrentContext()
    ).FromJust();
  }
  void unload(args_t args) {
    autoRef.Reset();
    manualRef.Reset();
  }
}
void Initialize(Local<Object> exportsObject) {
  Isolate* isolate = exportsObject->GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  auto Register = [exportsObject, isolate, context]<size_t N>(
    const char (&str)[N],
    void(*cb)(args_t)
  ){
    exportsObject->Set(
      context,
      String::NewFromUtf8(isolate, str, NewStringType::kNormal, N-1).ToLocalChecked(),
      FunctionTemplate::New(isolate, cb)->GetFunction(context).ToLocalChecked()
    ).ToChecked();
  };

  Register("loopAutoDetach", exports::loopAutoDetach);
  Register("setLoopAutoDetach", exports::setLoopAutoDetach);
  Register("loopManualDetach", exports::loopManualDetach);
  Register("setLoopManualDetach", exports::setLoopManualDetach);
  Register("manualDetach", exports::manualDetach);
  Register("setIterations", exports::setIterations);
  Register("unload", exports::unload);
}

NODE_MODULE(addon, Initialize)
