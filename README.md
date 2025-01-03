# My Website
Here are my HTML, CSS and JS files to build my first static website:

> [!IMPORTANT]
> Although I am pleased to share my codes with the broader community for education, research and development purposes, I do not take any responsibility for the results obtained. You are fully responsible for your results.
> **Attribution:** If you use this code for academic of research purposes, proper attribution to the original author (myself) is appreciated.

> [!TIP]
> Go through this ReadMe file in detail to understand the repository structure and the usage of the scripts.

## Requirements
> [!NOTE]
> - **Python 3** or later version. You might need to install additional packages to run the scripts.

## Repository Structure
> [!WARNING]
> Codes might contain bugs, and might not be optimized for performance.

As of January 2024, the repository is organized as follows:

### Data Extraction
These scripts require a .odb file containing the results of a simulation.
Some of the scripts might contain additional instructions within the code to be uncommented, depending on the visualization needs.

- [ ] **Sets_ODB.py:**
- [ ] **Extract_Responses.py:**

> [!TIP]
> Familiarize with the Abaqus GUI features in advance to smoothly navigate through the code comments.

### Scientific Visualization
These scripts require .txt file containing nodal information per time step, as output by the script '2.Extract_Responses.py'.
Some of the scripts might contain additional instructions within the code to be uncommented, depending on the visualization needs.

- [ ] **Plot_Depth.py:**
- [ ] **Plot_Main.py:**
- [ ] **Plot_U2.py:**
- [ ] **Plot_U2_Animation.py:**

> [!TIP]
> By default, the code outputs a set of plots for each time step. To output a single plot, uncomment the corresponding line in the code.

### Dynamic Modulus
Creates a Prony series fit of the dynamic modulus master curve based on E* or AMPT test data, and outputs the coefficients of the Prony series.
The prony terms can be used to create a viscoelastic material model in Abaqus.

> [!TIP]
> Uncomment unrequired plots before executing the code.

### Temperature Gradient
Creates a temperature gradient fit based on initial and final temperature data, and outputs temperatures values at different depths of a pavement structure.
The model parameters can be modified to meet specific needs (curve shape, gradient rate, etc)

> [!IMPORTANT]
> Credits:
> 
	Demo Images:
		Dreametry Doodle (dreametrydoodle.com)
	Icons:
		Font Awesome (fontawesome.io)
	Other:
		jQuery (jquery.com)
		Responsive Tools (github.com/ajlkn/responsive-tools)

 ## Acknowledgements

 - [Illinois Campus Cluster](https://campuscluster.illinois.edu/)
 - [Advanced Cyberinfrastructure Coordination Ecosystem: Services & Support](https://access-ci.org/)
 - [Illinois Center for Transportation](https://ict.illinois.edu/)

## Contributing

Contributions are always welcome!

See `contributing.md` for ways to get started.

Please adhere to this project's `code of conduct`.

## Licensing

[![MIT License](https://img.shields.io/badge/License-Illinois-green.svg)](https://opensource.org/licenses/) <br>
[![AGPL License](https://img.shields.io/badge/License-ICT-blue.svg)](https://opensource.org/licenses/) <br>
[![GPLv3 License](https://img.shields.io/badge/License-Mechanics%20v1-yellow.svg)](https://opensource.org/licenses/)

```powershell
This software is not free and not released into the public domain.

Permission is granted to any person to copy, modify, publish, use, compile, sell or distribute this
software, whether in source code form or as a compiled binary, for any purpose—commercial or non
commercial—and by any means. However, if you do so, regardless if the license your project uses,
the author of this project reserves the right to freely copy and use code from your project in
any form, including source code, compiled binaries, or any derived works.

Disclaimer:
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT.
IN NO EVENT SHALL THE AUTHOR(S) BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT, OR OTHERWHISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR 
OTHER DEALINGS IN THE SOFTWARE.

``` 
