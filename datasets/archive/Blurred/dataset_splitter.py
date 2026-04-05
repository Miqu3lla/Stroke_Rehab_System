import splitfolders

# The TRUE realm where your current images reside
input_folder = "C:/Users/Matthew Dee/Documents/School work/LSPU/School works/3rd year/2nd sem/CMSC 312/Datasets/Therapy Datasets/archive/Blurred" 

# The new realm where the split data will be forged
output_folder = "C:/Users/Matthew Dee/Documents/School work/LSPU/School works/3rd year/2nd sem/CMSC 312/Datasets/Therapy Datasets/Ready_Dataset"

# Execute the split! 
# The ratio dictates: 70% Training, 20% Validation, 10% Testing
print("Forging the new dataset realms...")

splitfolders.ratio(
    input_folder, 
    output=output_folder, 
    seed=42, # Keeps the randomness consistent if you run it again
    ratio=(0.7, 0.2, 0.1), # Train, Val, Test percentages
    group_prefix=None, # Keep as None
    move=False # Set to True if you want to MOVE files instead of COPYING them
)

print("Victory! The dataset is ready for the neural networks.")