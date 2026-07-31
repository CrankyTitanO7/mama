# Mama

An AI development app that visually guides a user through training and running a model locally. This app prioritizes ease, efficiency, and control.

author: Jaden Lee

## install 
you can do two main methods of install. 
### running with python
the app currently requires pip in order to install the necessary machine learning libraries so you can run your own training model. One method is to download the source code, then install (either in a venv or globally) pywebview, and then running the main.py script:
```bash
# for a specific release
git clone -b 'v2.0' --single-branch --depth 1 https://github.com/CrankyTitanO7/mama.git
# for the newest repository without history (may contain bugs)
git clone --depth 1 https://github.com/CrankyTitanO7/mama.git
```

```bash
pip install pywebview
python main.py
```
This method is also easier to customize your app experience (ie generating your own theme files or writing your own setup modules)

### download a release 
github actions also auto-generates an executable app enclosed in a zip file using pyinstaller. You can run these, but python is marked as a dependency, and certain steps such as installing pytorch may fail without installing python

for mac users, it may take a moment to launch at first (when the .app is run for the first time, it has to copy everything to Library folder) but subsequent launches will be faster. Also, you may have to allow the app to run by going to Settings -> privacy + security -> allow app store apps and trusted developers -> allow mama to run. 
Additionally, if you do not have command line tools installed, MacOS may prompt you to install them in order to use python.

## complete uninstall
### macos
1) delete the app
2) delete ~/Library/Caches/com.crankytitano7.mama
### windows 
1) delete the app
2) delete C:\Users\USERNAME\AppData\Roaming\mama
### linux
1) delete the app
2) your app cache data may be in ~/.config or ~/.local/share/

## Acknowledgements
- pytorch template from [pytorch-template](https://github.com/victoresque/pytorch-template.git) by @victoresque

- tensorflow template from [Tensorflow-Project-Template](https://github.com/mgsalem/Tensorflow-Project-Template.git) by @mgsalem