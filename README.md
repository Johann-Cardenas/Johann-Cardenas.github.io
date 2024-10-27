# My Website
Here are my HTML, CSS and JS files to build my first website (static:

> [!IMPORTANT]
> Although I am pleased to share my codes with the broader community for education, research and development purposes, I do not take any responsibility for the results obtained. You are fully responsible for your results.
> **Attribution:** If you use this code for academic of research purposes, proper attribution to the original author (myself) is appreciated.

> [!TIP]
> Go through this ReadMe file in detail to understand the repository structure and the usage of the scripts.

## Requirements
> [!NOTE]
> - **Abaqus 2021** or later version. Older output database files need to be upgraded first. 
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
