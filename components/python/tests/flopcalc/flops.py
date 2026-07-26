import torch
import torchvision.models as models
from calflops import calculate_flops

# 1. Initialize your model
model = models.resnet18()
batch_size = 1
input_shape = (batch_size, 3, 224, 224)

# 2. Compute FLOPs, MACs, and Parameter counts
flops, macs, params = calculate_flops(model=model, 
                                      input_shape=input_shape,
                                      output_as_string=True,
                                      output_precision=4)

print(f"ResNet18 complexity:")
print(f"FLOPs: {flops}")
print(f"MACs: {macs}")
print(f"Parameters: {params}")
