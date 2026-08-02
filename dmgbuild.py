import os

base = os.getcwd()
app_name = 'mama'

volume_name = 'mama'
app_path = 'dist/mama.app'
background = os.path.join(base, 'icons', 'dmg-background.png')
icon = os.path.join(base, 'icons', 'icon.icns')

format = 'UDZO'
size = None

files = [app_path, '/Applications']
symlinks = {}
badge_icon = icon

icon_locations = {
    app_name + '.app': (220, 190),
    '/Applications': (440, 190),
}
window_rect = ((100, 100), (660, 400))
icon_size = 110
text_size = 14
background_color = None
