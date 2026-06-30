# to do list 

## bugs (known)
- doesn't quit all the way sometimes (mac)
- <del> user settings are softlocked on first launch. The setup wizard is not run because settings.json doesn't exist yet. </del>
- due to missing certification, users on mac must run 
    ```zsh
    xattr -cr /path/to/application
    ```

## features
- finish multimodel designer
    - build basic training script-template

- build folder loader (important!) (also, do memory scan. make sure drive has enough memory for project)

- create prereq loaders
    - pytorch (from site)
        - solve refreshing problem (probably via web-analysis?)
        - REMEMBER MPS ONLY SUPPORTED ON NIGHTLY BUILD!!! HARDWARE DETECTION COMES FIRST
    - amd (rocm)
        - static load from documentation site
    - nvidia cuda
        - static load from documentation site

- bounty system loader
    - build external website (hosted via vercel? github statics? generated from gist?)
    - build refresh cache

## documentation

- finish documentation, somehow

## git and build

- ACTIVATE LFS BEFORE UPLOADING DESIGNS
- write README.MD
- configure git repo contribute settings, license settings, etc.

## aesthetic
- redesign default themes 
- design icons (BEFORE UPLOADING, ACTIVATE GIT LFS)

## long term
- language support