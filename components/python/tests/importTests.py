print("this is a test for your imports") 

try: 
    import torch
except ImportError:
    print("could not import pytorch")
    print(ImportError)
    