<sub>[Kavana docs](README.md) › Using Kavana</sub>

# Sounds

The background sounds in Kavana are real recordings, except brown noise and white noise, which the app makes itself. They all come from [Freesound](https://freesound.org), and every one is CC0, which means the people who recorded them gave them away to everyone, no strings attached. Nobody has to credit them for that, but I want to, so here's whose each one is.

| Sound | The recording | By |
|---|---|---|
| Purring | [Female cat purr](https://freesound.org/people/Sadiquecat/sounds/695630/), a cat called Pearl lying on her side | Sadiquecat |
| Rain | [Light rain in a field of bananas trees](https://freesound.org/people/felix.blume/sounds/512334/), in Veracruz, Mexico | felix.blume |
| Café | [Restaurant Atmosphere (crowded)](https://freesound.org/people/felix.blume/sounds/422097/), a restaurant in São Paulo around midnight | felix.blume |
| Fireplace | [Fireplace for Six Minutes (Stereo)](https://freesound.org/people/petebuchwald/sounds/496130/), a wood stove up close | petebuchwald |
| Waves | [Wave on the beach in Thailand, at 20 meters form the water, during the night](https://freesound.org/people/felix.blume/sounds/510236/) | felix.blume |
| Birds | [Bird ambience. Coniferous forest dawn chorus.](https://freesound.org/people/SamsterBirdies/sounds/745273/), by a lake | SamsterBirdies |
| Night | [Night Ambience 01 - Aug 2 2013 - Back Yard](https://freesound.org/people/rgbrobot/sounds/195969/), crickets and cicadas in Atlanta | rgbrobot |
| Wind | [Howling winter storm ambient sounds](https://freesound.org/people/DBlover/sounds/505999/), mixed from DBlover's own recording and five more CC0 ones, by Jeffreys2 ([one](https://freesound.org/people/Jeffreys2/sounds/327771/), [two](https://freesound.org/people/Jeffreys2/sounds/327772/)), [felix.blume](https://freesound.org/people/felix.blume/sounds/211463/), [krnd](https://freesound.org/people/krnd/sounds/90898/) and [courter](https://freesound.org/people/courter/sounds/447823/) | DBlover |

Three of them are by felix.blume, and his page on Freesound has lots more like them, if you like these.

For Birds I wanted a quiet garden in the morning, but every garden recording I tried had something in it that would stand out every time the loop came round (a pheasant, a rooster, a plane), so it's a forest at dawn instead.

## How they're made

Each one is a stretch of the recording, a minute or so, with its end blended into its start so it loops without a seam. They're all set to about the same loudness as each other (and as the versions the app makes on the device), so switching sounds doesn't make you jump. They're MP3s of about a megabyte each, and one only downloads the first time you pick it. Until it's there, or if you're offline, Kavana plays a version it makes on the device, and the recording fades in once it arrives.

`tools/fetch-sounds.py` makes them, and the picks are listed in it: which recording, where in it the loop starts and how long it is. So anyone can make them again, or swap one for another recording. [Developing Kavana](DEVELOPING.md) has the rest of how the code works.

<sub>Back to [A focus block](focus-blocks.md)</sub>
