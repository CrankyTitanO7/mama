# how to use 

## available pages

### homepage (available by clicking the logo top left)

here is an overview of current projects and a computer resource overview, as well as other quality of life "widgets" as needed.

### setup menu

this is where you can run the setup wizard again. it will auto-scan your system to determine prerequisites

### settings

this is where you can change several settings about the app. It can also be edited in the app files user/settings.json. it was intentionally designed to be flexible, portable, and easy to access.

several settings are optional and not needed for core functions, but they are used in several of the apps tests. for example, several installers require the OS field to be filled out, as they determine the system OS via the settings json file, and not through other means.

### multimodel design

an easy gui for designing multi-model systems

### database explorer

a quality of life feature allowing the user to easy browse a web database (such as huggingface) to easily transfer information from outside sources.

### export model

a page designed to walk a user through exporting a model for any use case. future aspirations include instant app/website generation (from template, not LLM), ollama (or other client) exports, etc. 

## baby's first project

1) make a directory
2) open directory with mama
3) design a multimodel interface, and save to directory
4) click begin training
5) export model

## settings (in-depth)

### general settings 

#### setup 
do you want to run the setup on startup of the app?
#### language 
what language do you speak

### aesthetic settings

#### appearance 
dark mode or light mode?

#### scaling factor
how zoomed should the app be? typically designed for an unforgiving window manager.

#### accent color 
accent color of the interface

### 